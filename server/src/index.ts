import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';
import path from 'path';
import http from 'http';
import app from './app';
import { config } from './config';
import { initializePassport } from './config/passport';
import { setupSocketIO } from './socket';
import { logger, toGuacamoleLogLevel } from './utils/logger';
import prisma from './lib/prisma';
import { startKeyRotationJob, startLdapSyncJob, startMembershipExpiryJob, startCheckoutExpiryJob, startPasswordRotationJob, stopAllJobs } from './services/scheduler.service';
import { startAllSyncJobs, stopAllSyncJobs } from './services/syncScheduler.service';
import { startAllMonitors, stopAllMonitors } from './services/gatewayMonitor.service';
import { cleanupExpiredShares } from './services/externalShare.service';
import { cleanupExpiredTokens, cleanupAbsolutelyTimedOutFamilies } from './services/auth.service';
import { checkExpiringSecrets } from './services/secretExpiry.service';
import { markServerReady } from './services/health.service';
import * as sessionService from './services/session.service';
import { destroyAllPools as destroyAllDbPools } from './services/dbQueryExecutor.service';
import { initSessionCleanup, checkAndCloseInactiveSessions } from './services/sessionCleanup.service';
import { detectOrchestrator, OrchestratorType } from './orchestrator';
import * as managedGatewayService from './services/managedGateway.service';
import * as autoscalerService from './services/autoscaler.service';
import { completeGuacRecording, cleanupExpiredRecordings } from './services/recording.service';
import { initGeoIp } from './services/geoip.service';
import { setupTunnelHandler } from './socket/tunnel.handler';
import { startSshProxyServer, stopSshProxyServer, restartSshProxy } from './services/sshProxy.service';
import { cleanupIdleTunnels } from './services/rdGateway.service';
import { cleanupExpiredDeviceCodes } from './services/deviceAuth.service';
import { applySystemSettings } from './services/systemSettings.service';
import { registerReload } from './services/configReloader.service';
import { reloadPassportStrategies } from './config/passport';
import { reloadKeyRotationJob, reloadLdapSyncJob } from './services/scheduler.service';
import { resetEmailProvider } from './services/email';
import { resetSmsProvider } from './services/sms';
import { rebuildLoginRateLimiter } from './middleware/loginRateLimit.middleware';
import { rebuildOauthRateLimiters } from './middleware/oauthRateLimit.middleware';
import { rebuildVaultRateLimiters } from './middleware/vaultRateLimit.middleware';
import { rebuildSessionRateLimiter } from './middleware/sessionRateLimit.middleware';

function freePort(port: number): void {
  try {
    execFileSync('fuser', ['-k', `${port}/tcp`], { stdio: 'pipe' });
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
  await applySystemSettings();

  // Recover orphaned sessions from previous server instance
  const recovered = await sessionService.recoverOrphanedSessions();
  if (recovered > 0) {
    logger.info(`Recovered ${recovered} orphaned session(s) from previous server instance`);
  }

  await initGeoIp();
  await initializePassport();

  const server = http.createServer(app);

  // Setup Socket.io for SSH
  const io = setupSocketIO(server);

  // Setup zero-trust tunnel WebSocket endpoint
  setupTunnelHandler(server);

  // Start SSH protocol proxy (if enabled)
  startSshProxyServer();

  // Initialize session cleanup with Socket.IO reference
  initSessionCleanup(io);

  // Start scheduled jobs
  startKeyRotationJob();
  startLdapSyncJob();
  startMembershipExpiryJob();
  startCheckoutExpiryJob();
  startPasswordRotationJob();
  startAllSyncJobs().catch((err) => {
    logger.error('Failed to start sync jobs:', err);
  });

  // Register live-reload callbacks for system settings
  for (const g of ['oauth-google', 'oauth-microsoft', 'oauth-github', 'oauth-oidc', 'oauth-saml']) {
    registerReload(g, reloadPassportStrategies);
  }
  registerReload('ldap', reloadLdapSyncJob);
  registerReload('key-rotation', reloadKeyRotationJob);
  registerReload('ssh-proxy', restartSshProxy);
  registerReload('email', resetEmailProvider);
  registerReload('sms', resetSmsProvider);
  registerReload('rate-limiting', rebuildLoginRateLimiter);
  registerReload('rate-limiting-advanced', rebuildOauthRateLimiters);
  registerReload('rate-limiting-advanced', rebuildSessionRateLimiter);
  registerReload('vault', rebuildVaultRateLimiters);
  registerReload('ai', () => { logger.verbose('AI/LLM settings reloaded'); });
  registerReload('feature-toggles', () => { logger.verbose('Feature toggles reloaded'); });
  registerReload('gateway', () => { logger.verbose('Gateway routing settings reloaded'); });

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

  // Cleanup token families that exceeded absolute session timeout (every 5 minutes)
  setInterval(() => {
    cleanupAbsolutelyTimedOutFamilies().catch((err) => {
      logger.error('Absolute timeout family cleanup failed:', err);
    });
  }, 5 * 60 * 1000);

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

  // Cleanup expired recordings daily
  setInterval(() => {
    cleanupExpiredRecordings().catch((err) => {
      logger.error('Recording cleanup failed:', err);
    });
  }, 24 * 60 * 60 * 1000);

  // Cleanup idle RD Gateway tunnels every minute
  setInterval(() => {
    cleanupIdleTunnels(config.sessionInactivityTimeoutSeconds).catch((err) => {
      logger.error('RD Gateway tunnel cleanup failed:', err);
    });
  }, 60 * 1000);

  // Cleanup expired device auth codes every 5 minutes
  setInterval(() => {
    cleanupExpiredDeviceCodes().catch((err) => {
      logger.error('Device auth code cleanup failed:', err);
    });
  }, 5 * 60 * 1000);


  // Setup guacamole-lite for RDP
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let guacServer: any = null;
  if (config.nodeEnv !== 'test') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const GuacamoleLite = require('guacamole-lite');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Crypt = require('guacamole-lite/lib/Crypt');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getGuacamoleKey } = require('./services/rdp.service');

      // Monkey-patch Crypt.js to support AES-256-GCM auth tags
      Crypt.prototype.decrypt = function (encodedString: string) {
        const encoded = JSON.parse(this.constructor.base64decode(encodedString));
        encoded.iv = Buffer.from(encoded.iv, 'base64');
        encoded.value = Buffer.from(encoded.value, 'base64');
        
        const decipher = crypto.createDecipheriv(this.cypher, this.key, encoded.iv);
        if (this.cypher.includes('GCM') && encoded.tag) {
          decipher.setAuthTag(Buffer.from(encoded.tag, 'base64'));
        }
        let decrypted = decipher.update(encoded.value, undefined, 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
      };

      guacServer = new GuacamoleLite(
        { port: config.guacamoleWsPort },
        {
          host: config.guacdHost,
          port: config.guacdPort,
        },
        {
          crypt: {
            cypher: 'AES-256-GCM',
            key: getGuacamoleKey(),
          },
          log: {
            level: config.logGuacamole ? toGuacamoleLogLevel(config.logLevel) : 0,
          },
        }
      );

      // Monkey-patch Server.js decryptToken to support AES-256-GCM auth tags
      guacServer.decryptToken = function (encryptedToken: string) {
        if (!this.clientOptions.crypt || !this.clientOptions.crypt.key) {
          throw new Error('Encryption key not configured');
        }
        try {
          const tokenData = JSON.parse(Buffer.from(encryptedToken, 'base64').toString());
          const decipher = crypto.createDecipheriv(
            this.clientOptions.crypt.cypher,
            this.clientOptions.crypt.key,
            Buffer.from(tokenData.iv, 'base64')
          );
          if (this.clientOptions.crypt.cypher.includes('GCM') && tokenData.tag) {
            decipher.setAuthTag(Buffer.from(tokenData.tag, 'base64'));
          }
          let decrypted = decipher.update(Buffer.from(tokenData.value, 'base64'), undefined, 'utf8');
          decrypted += decipher.final('utf8');
          return JSON.parse(decrypted);
        } catch (error) {
          throw new Error('Failed to decrypt token: ' + (error as Error).message);
        }
      };

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
          logger.debug(`Guacamole tunnel opened for connection ${metadata.connectionId}`);
        }
      });

      // Safety net: close persistent session and finalize recording when guac connection closes.
      // Note: guacamole-lite deletes the raw token after decryption, so we use
      // the metadata object (userId + connectionId + recordingId) which IS preserved.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      guacServer.on('close', (clientConnection: any) => {
        try {
          const metadata = clientConnection.connectionSettings?.metadata;
          const connType = clientConnection.connectionSettings?.connection?.type;
          const protocol = connType === 'vnc' ? 'VNC' : 'RDP';
          if (metadata?.userId && metadata?.connectionId) {
            sessionService.closeStaleSessionsForConnection(
              metadata.userId,
              metadata.connectionId,
              protocol,
            ).catch((err: unknown) => {
              logger.error('Failed to end session on guac close:', err);
            });

            // Finalize recording if one was started
            if (metadata.recordingId) {
              completeGuacRecording(metadata.recordingId).catch((err: unknown) => {
                logger.error('Failed to complete recording on guac close:', err);
              });
            }
          }
        } catch {
          // Ignore — session will be cleaned up by idle timeout
        }
      });

      // Log configured guacd image version — guacamole-lite doesn't expose
      // the actual guacd version from the handshake, so we log the configured
      // image to help operators verify disable-gfx support (requires >= 1.6.0,
      // GUACAMOLE-377).
      const guacdImage = config.orchestratorGuacdImage;
      const versionMatch = guacdImage.match(/:(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        const [major, minor] = versionMatch[1].split('.').map(Number);
        const meetsMinimum = major > 1 || (major === 1 && minor >= 6);
        if (!meetsMinimum) {
          logger.warn(
            `[guacd] Configured image ${guacdImage} is below minimum version 1.6.0 — ` +
            `disable-gfx will not work and RDP recordings may show a black screen`
          );
        } else {
          logger.info(`[guacd] Configured image: ${guacdImage} (disable-gfx supported)`);
        }
      } else {
        logger.warn(
          `[guacd] Could not determine version from image "${guacdImage}" — ` +
          `ensure guacd >= 1.6.0 for RDP recording support (disable-gfx)`
        );
      }

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
    stopAllSyncJobs();

    // Close all active sessions gracefully
    try {
      const closed = await sessionService.recoverOrphanedSessions();
      if (closed > 0) {
        logger.info(`Closed ${closed} active session(s) on shutdown`);
      }
    } catch (err) {
      logger.error('Failed to close sessions on shutdown:', err);
    }

    // Close all DB query executor pools
    await destroyAllDbPools();

    // Stop SSH proxy server
    stopSshProxyServer();

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

main().catch((err) => logger.error('Fatal startup error:', err instanceof Error ? err.message : 'Unknown error'));
