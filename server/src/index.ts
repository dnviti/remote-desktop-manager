import { execSync } from 'child_process';
import path from 'path';
import http from 'http';
import app from './app';
import { config } from './config';
import { initializePassport } from './config/passport';
import { setupSocketIO } from './socket';
import { logger, toGuacamoleLogLevel } from './utils/logger';
import prisma from './lib/prisma';
import { startKeyRotationJob, stopAllJobs } from './services/scheduler.service';
import { startAllMonitors, stopAllMonitors } from './services/gatewayMonitor.service';
import { cleanupExpiredShares } from './services/externalShare.service';
import { cleanupExpiredTokens } from './services/auth.service';
import { checkExpiringSecrets } from './services/secretExpiry.service';
import { markServerReady } from './services/health.service';
import * as sessionService from './services/session.service';
import { initSessionCleanup, checkAndCloseInactiveSessions } from './services/sessionCleanup.service';
import { detectOrchestrator, OrchestratorType } from './orchestrator';
import * as managedGatewayService from './services/managedGateway.service';
import * as autoscalerService from './services/autoscaler.service';

function freePort(port: number): void {
  try {
    execSync(`fuser -k ${port}/tcp`, { stdio: 'pipe' });
    logger.info(`Killed stale process on port ${port}`);
  } catch {
    // No process on that port — nothing to do
  }
}

async function runDatabaseMigrations() {
  const serverDir = path.resolve(__dirname, '..');
  try {
    logger.info('Running database migrations...');
    execSync('npx prisma migrate deploy', {
      cwd: serverDir,
      stdio: 'pipe',
      env: { ...process.env },
    });
    logger.info('Database migrations applied successfully');
  } catch (err) {
    const message = err instanceof Error ? err.message : err;
    logger.error('Database migration failed:', message);
    throw err;
  }
}

async function runStartupMigrations() {
  // Mark existing users without emailVerified as verified so they aren't locked out
  const emailResult = await prisma.user.updateMany({
    where: { emailVerified: false, emailVerifyToken: null },
    data: { emailVerified: true },
  });
  if (emailResult.count > 0) {
    logger.info(`Startup migration: marked ${emailResult.count} existing user(s) as email-verified`);
  }

  // Ensure existing users with a password have vaultSetupComplete = true
  const vaultResult = await prisma.user.updateMany({
    where: {
      vaultSetupComplete: false,
      passwordHash: { not: null },
    },
    data: { vaultSetupComplete: true },
  });
  if (vaultResult.count > 0) {
    logger.info(`Startup migration: marked ${vaultResult.count} user(s) as vault-setup-complete`);
  }
}

async function main() {
  // Kill stale processes from previous runs (e.g. tsx watch restart, debugger)
  freePort(config.port);
  freePort(config.guacamoleWsPort);

  await runDatabaseMigrations();
  await runStartupMigrations();

  // Recover orphaned sessions from previous server instance
  const recovered = await sessionService.recoverOrphanedSessions();
  if (recovered > 0) {
    logger.info(`Recovered ${recovered} orphaned session(s) from previous server instance`);
  }

  await initializePassport();

  const server = http.createServer(app);

  // Setup Socket.io for SSH
  const io = setupSocketIO(server);

  // Initialize session cleanup with Socket.IO reference
  initSessionCleanup(io);

  // Start scheduled jobs (SSH key rotation cron)
  startKeyRotationJob();

  // Start gateway health monitors
  startAllMonitors();

  // Detect and initialize container orchestrator
  const orchestrator = await detectOrchestrator();
  logger.info(`Orchestrator provider: ${orchestrator.type}`);

  // Managed gateway health check and reconciliation (only if orchestrator available)
  if (orchestrator.type !== OrchestratorType.NONE) {
    setInterval(() => {
      managedGatewayService.healthCheck().catch((err) => {
        logger.error('Managed gateway health check failed:', err);
      });
    }, 30 * 1000);

    setInterval(() => {
      managedGatewayService.reconcileAll().catch((err) => {
        logger.error('Managed gateway reconciliation failed:', err);
      });
    }, 5 * 60 * 1000);

    setInterval(() => {
      autoscalerService.evaluateScaling().catch((err) => {
        logger.error('Auto-scaling evaluation failed:', err);
      });
    }, 30 * 1000);

    logger.info('[managed-gateway] Health check (30s), reconciliation (5m), and auto-scaling (30s) scheduled');
  }

  // Cleanup expired external shares every hour
  setInterval(() => {
    cleanupExpiredShares().catch((err) => {
      logger.error('Failed to cleanup expired external shares:', err);
    });
  }, 60 * 60 * 1000);

  // Cleanup expired refresh tokens every hour
  setInterval(() => {
    cleanupExpiredTokens().catch((err) => {
      logger.error('Failed to cleanup expired refresh tokens:', err);
    });
  }, 60 * 60 * 1000);

  // Check for expiring secrets every 6 hours
  setInterval(() => {
    checkExpiringSecrets().catch((err) => {
      logger.error('Secret expiry check failed:', err);
    });
  }, 6 * 60 * 60 * 1000);

  // Mark idle sessions every minute
  setInterval(() => {
    sessionService.markIdleSessions(config.sessionIdleThresholdMinutes).then((count) => {
      if (count > 0) logger.info(`Marked ${count} session(s) as idle`);
    }).catch((err) => {
      logger.error('Failed to mark idle sessions:', err);
    });
  }, 60 * 1000);

  // Close inactive sessions every minute
  setInterval(() => {
    checkAndCloseInactiveSessions().then((count) => {
      if (count > 0) logger.info(`Session cleanup: closed ${count} inactive session(s)`);
    }).catch((err) => {
      logger.error('Session inactivity cleanup failed:', err);
    });
  }, 60 * 1000);

  // Cleanup old closed sessions daily
  setInterval(() => {
    sessionService.cleanupClosedSessions(config.sessionCleanupRetentionDays).then((count) => {
      if (count > 0) logger.info(`Cleaned up ${count} old closed session(s)`);
    }).catch((err) => {
      logger.error('Failed to cleanup closed sessions:', err);
    });
  }, 24 * 60 * 60 * 1000);

  // Setup guacamole-lite for RDP
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let guacServer: any = null;
  if (config.nodeEnv !== 'test') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const GuacamoleLite = require('guacamole-lite');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGuacamoleKey } = require('./services/rdp.service');
      guacServer = new GuacamoleLite(
        { port: config.guacamoleWsPort },
        {
          host: config.guacdHost,
          port: config.guacdPort,
        },
        {
          crypt: {
            cypher: 'AES-256-CBC',
            key: getGuacamoleKey(),
          },
          log: {
            level: toGuacamoleLogLevel(config.logLevel),
          },
        }
      );

      guacServer.on('error', (_clientConnection: unknown, error: unknown) => {
        logger.error(
          'Guacamole connection error:',
          error instanceof Error ? error.message : error
        );
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      guacServer.on('open', (clientConnection: any) => {
        const metadata = clientConnection.connectionSettings?.metadata;
        if (metadata) {
          logger.debug(`Guacamole RDP tunnel opened for connection ${metadata.connectionId}`);
        }
      });

      // Safety net: close persistent session if client didn't explicitly end it.
      // Note: guacamole-lite deletes the raw token after decryption, so we use
      // the metadata object (userId + connectionId) which IS preserved.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      guacServer.on('close', (clientConnection: any) => {
        try {
          const metadata = clientConnection.connectionSettings?.metadata;
          if (metadata?.userId && metadata?.connectionId) {
            sessionService.closeStaleSessionsForConnection(
              metadata.userId,
              metadata.connectionId,
              'RDP',
            ).catch((err: unknown) => {
              logger.error('Failed to end RDP session on guac close:', err);
            });
          }
        } catch {
          // Ignore — session will be cleaned up by idle timeout
        }
      });

      logger.info(
        `Guacamole WebSocket server listening on port ${config.guacamoleWsPort}`
      );
    } catch (err) {
      logger.warn(
        'guacamole-lite not available. RDP connections will not work.',
        err instanceof Error ? err.message : err
      );
    }
  }

  server.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    markServerReady();
  });

  const shutdown = async () => {
    logger.info('Shutting down...');
    stopAllMonitors();
    stopAllJobs();

    // Close all active sessions gracefully
    try {
      const closed = await sessionService.recoverOrphanedSessions();
      if (closed > 0) {
        logger.info(`Closed ${closed} active session(s) on shutdown`);
      }
    } catch (err) {
      logger.error('Failed to close sessions on shutdown:', err);
    }

    if (guacServer) {
      try {
        guacServer.close();
        logger.info('Guacamole WebSocket server closed.');
      } catch {
        // Ignore close errors during shutdown
      }
    }

    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => logger.error(err));
