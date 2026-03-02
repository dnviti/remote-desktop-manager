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
import { checkExpiringSecrets } from './services/secretExpiry.service';
import { markServerReady } from './services/health.service';
import * as auditService from './services/audit.service';
import { formatDuration } from './utils/format';

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
  await runDatabaseMigrations();
  await runStartupMigrations();
  await initializePassport();

  const server = http.createServer(app);

  // Setup Socket.io for SSH
  setupSocketIO(server);

  // Start scheduled jobs (SSH key rotation cron)
  startKeyRotationJob();

  // Start gateway health monitors
  startAllMonitors();

  // Cleanup expired external shares every hour
  setInterval(() => {
    cleanupExpiredShares().catch((err) => {
      logger.error('Failed to cleanup expired external shares:', err);
    });
  }, 60 * 60 * 1000);

  // Check for expiring secrets every 6 hours
  setInterval(() => {
    checkExpiringSecrets().catch((err) => {
      logger.error('Secret expiry check failed:', err);
    });
  }, 6 * 60 * 60 * 1000);

  // Setup guacamole-lite for RDP
  if (config.nodeEnv !== 'test') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const GuacamoleLite = require('guacamole-lite');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGuacamoleKey } = require('./services/rdp.service');
      const guacServer = new GuacamoleLite(
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

      guacServer.on('error', (clientConnection: unknown, error: unknown) => {
        logger.error(
          'Guacamole connection error:',
          error instanceof Error ? error.message : error
        );
      });

      // Track RDP session start times for duration calculation
      const rdpSessionStartTimes = new Map<number, number>();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      guacServer.on('open', (clientConnection: any) => {
        const metadata = clientConnection.connectionSettings?.metadata;
        if (metadata) {
          rdpSessionStartTimes.set(clientConnection.connectionId, Date.now());
          auditService.log({
            userId: metadata.userId,
            action: 'SESSION_START',
            targetType: 'Connection',
            targetId: metadata.connectionId,
            details: {
              protocol: 'RDP',
              host: clientConnection.connectionSettings.connection?.settings?.hostname,
              port: clientConnection.connectionSettings.connection?.settings?.port,
            },
            ipAddress: metadata.ipAddress,
          });
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      guacServer.on('close', (clientConnection: any) => {
        const metadata = clientConnection.connectionSettings?.metadata;
        if (metadata) {
          const startTime = rdpSessionStartTimes.get(clientConnection.connectionId);
          const durationMs = startTime ? Date.now() - startTime : undefined;
          rdpSessionStartTimes.delete(clientConnection.connectionId);
          auditService.log({
            userId: metadata.userId,
            action: 'SESSION_END',
            targetType: 'Connection',
            targetId: metadata.connectionId,
            details: {
              protocol: 'RDP',
              host: clientConnection.connectionSettings.connection?.settings?.hostname,
              port: clientConnection.connectionSettings.connection?.settings?.port,
              ...(durationMs !== undefined && {
                durationMs,
                durationFormatted: formatDuration(durationMs),
              }),
            },
            ipAddress: metadata.ipAddress,
          });
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

  const shutdown = () => {
    logger.info('Shutting down...');
    stopAllMonitors();
    stopAllJobs();
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => logger.error(err));
