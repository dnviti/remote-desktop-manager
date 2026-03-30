import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import app from './app';
import { config } from './config';
import { initializePassport } from './config/passport';
import { logger, toGuacamoleLogLevel } from './utils/logger';
import prisma from './lib/prisma';
import { startKeyRotationJob, startLdapSyncJob, startMembershipExpiryJob, startCheckoutExpiryJob, startPasswordRotationJob, startSystemSecretRotationJob, stopAllJobs } from './services/scheduler.service';
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
import { generateSelfSignedServerCert } from './utils/certGenerator';
import { startGatewayEventSubscriptions, publishGatewayEvent, GatewayEventType } from './services/gatewayEventBus.service';
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
import { runIfLeader } from './utils/leaderElection';

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
  if (config.nodeEnv === 'development') {
    const devAdminEmail = (process.env.DEV_BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
    const unlockResult = await prisma.user.updateMany({
      where: {
        email: devAdminEmail,
        OR: [
          { lockedUntil: { not: null } },
          { failedLoginAttempts: { gt: 0 } },
        ],
      },
      data: {
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    });
    if (unlockResult.count > 0) {
      logger.info(`Startup migration: cleared login lock state for ${unlockResult.count} development admin account(s)`);
    }
  }

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

function checkProductionSecurityConfig(): void {
  if (config.nodeEnv !== 'production') return;

  if (!config.guacdSsl) {
    logger.warn('[security] guacd communication uses plaintext TCP — set GUACD_SSL=true and configure GUACD_CA_CERT');
  }
  if (!config.tunnelServerCert) {
    logger.warn('[security] Tunnel endpoint running without TLS — mTLS enforcement requires TUNNEL_SERVER_CERT/KEY');
  }
  if (!config.gatewayGrpcTlsCa || !config.gatewayGrpcTlsCert || !config.gatewayGrpcTlsKey) {
    logger.warn('[security] Gateway gRPC key push lacks mTLS — set GATEWAY_GRPC_TLS_CA/CERT/KEY');
  }
  if (!config.guacencAuthToken) {
    logger.warn('[security] Guacenc auth token not initialized — system secrets may have failed to load');
  }
  if (config.ldap.enabled && !config.ldap.starttls && !config.ldap.serverUrl.startsWith('ldaps://')) {
    logger.warn('[security] LDAP enabled without TLS — enable LDAP_STARTTLS or use ldaps:// URL');
  }
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('sslmode')) {
    logger.warn('[security] DATABASE_URL lacks sslmode parameter — consider adding sslmode=require');
  }

  // Check OAuth callback URLs for HTTP (except localhost)
  const oauthProviders = [
    { name: 'Google', url: config.oauth.google.callbackUrl, enabled: config.oauth.google.enabled },
    { name: 'Microsoft', url: config.oauth.microsoft.callbackUrl, enabled: config.oauth.microsoft.enabled },
    { name: 'GitHub', url: config.oauth.github.callbackUrl, enabled: config.oauth.github.enabled },
    { name: 'OIDC', url: config.oauth.oidc.callbackUrl, enabled: config.oauth.oidc.enabled },
    { name: 'SAML', url: config.oauth.saml.callbackUrl, enabled: config.oauth.saml.enabled },
  ];
  for (const provider of oauthProviders) {
    if (provider.enabled && provider.url.startsWith('http://') && !provider.url.includes('://localhost')) {
      logger.warn(`[security] ${provider.name} OAuth callback URL uses HTTP — use HTTPS in production`);
    }
  }

  if (!config.geoipDbPath) {
    logger.info('[security] GeoIP database not configured — IP geolocation enrichment disabled. Set GEOIP_DB_PATH for offline lookups instead of http://ip-api.com');
  }
}

async function main() {
  // Only do dev-time port cleanup for local watch/debug workflows.
  if (config.nodeEnv === 'development') {
    freePort(config.port);
    freePort(config.guacamoleWsPort);
  }

  await runDatabaseMigrations();
  await runStartupMigrations();
  await applySystemSettings();

  // Initialize auto-managed system secrets (JWT, Guacamole, guacenc)
  const { ensureSystemSecrets } = await import('./services/systemSecrets.service');
  await ensureSystemSecrets();

  // Check for insecure production configurations
  checkProductionSecurityConfig();

  // Recover orphaned sessions from previous server instance
  const recovered = await sessionService.recoverOrphanedSessions();
  if (recovered > 0) {
    logger.info(`Recovered ${recovered} orphaned session(s) from previous server instance`);
  }

  await initGeoIp();
  await initializePassport();

  // ---------------------------------------------------------------------------
  // TLS configuration — the main server ALWAYS uses HTTPS.
  // When explicit certs are provided via SERVER_TLS_CERT/KEY, those are used.
  // Otherwise, auto-generate self-signed certs for development.
  // ---------------------------------------------------------------------------
  let serverTlsOptions: https.ServerOptions;

  if (config.serverTlsCert && config.serverTlsKey) {
    serverTlsOptions = {
      cert: fs.readFileSync(config.serverTlsCert),
      key: fs.readFileSync(config.serverTlsKey),
    };
    logger.info('[tls] Main server using provided TLS certificates');
  } else {
    const devCert = generateSelfSignedServerCert();
    serverTlsOptions = { cert: devCert.cert, key: devCert.key };
    logger.info('[tls] Main server using auto-generated self-signed certificate (development only)');
  }

  const server = https.createServer(serverTlsOptions, app);

  // Dedicated tunnel HTTPS server with mTLS (requestCert: true) on port+10.
  // The main server does NOT require client certs — browsers connect to it.
  let tunnelServer: http.Server | https.Server;
  if (config.tunnelServerCert && config.tunnelServerKey) {
    try {
      if (config.tunnelStrictMtls && !config.tunnelServerCa) {
        throw new Error('TUNNEL_SERVER_CA is required when TUNNEL_STRICT_MTLS=true');
      }
      const tunnelTlsOptions: https.ServerOptions = {
        cert: fs.readFileSync(config.tunnelServerCert),
        key: fs.readFileSync(config.tunnelServerKey),
        requestCert: true,
        rejectUnauthorized: config.tunnelStrictMtls,
      };
      if (config.tunnelServerCa) {
        tunnelTlsOptions.ca = fs.readFileSync(config.tunnelServerCa);
      }
      tunnelServer = https.createServer(tunnelTlsOptions, app);
      logger.info(
        config.tunnelStrictMtls
          ? '[tunnel] TLS enabled for tunnel endpoint — strict mTLS client certificate verification is active'
          : '[tunnel] TLS enabled for tunnel endpoint — client certificates will be authorized in-app',
      );
    } catch (err) {
      logger.error('[tunnel] Failed to load tunnel TLS certificates:', err instanceof Error ? err.message : 'Unknown error');
      logger.warn('[tunnel] Falling back to main HTTPS server for tunnel endpoint — mTLS enforcement disabled');
      tunnelServer = server;
    }
  } else {
    logger.warn('[tunnel] TUNNEL_SERVER_CERT/KEY not configured — tunnel shares main HTTPS server, mTLS enforcement disabled');
    tunnelServer = server;
  }

  // Setup zero-trust tunnel WebSocket endpoint (on the TLS-enabled server when available)
  setupTunnelHandler(tunnelServer);

  // Start SSH protocol proxy (if enabled)
  startSshProxyServer();

  // Initialize session cleanup hooks
  initSessionCleanup();

  // Start scheduled jobs
  startKeyRotationJob();
  startLdapSyncJob();
  startMembershipExpiryJob();
  startCheckoutExpiryJob();
  startPasswordRotationJob();
  startSystemSecretRotationJob();
  startAllSyncJobs().catch((err) => {
    logger.error('Failed to start sync jobs:', err instanceof Error ? err.message : 'Unknown error');
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

  // Start gateway event bus (must subscribe before events are published)
  await startGatewayEventSubscriptions();

  // Detect and initialize container orchestrator
  const orchestrator = await detectOrchestrator();
  logger.info(`Orchestrator provider: ${orchestrator.type}`);

  // Managed gateway health check and reconciliation (only if orchestrator available)
  if (orchestrator.type !== OrchestratorType.NONE) {
    setInterval(() => {
      runIfLeader('scheduler', async () => {
        await managedGatewayService.healthCheck();
      }).catch((err) => {
        logger.error('Managed gateway health check failed:', err instanceof Error ? err.message : 'Unknown error');
      });
    }, 30 * 1000);

    setInterval(() => {
      runIfLeader('scheduler', async () => {
        await managedGatewayService.reconcileAll();
      }).catch((err) => {
        logger.error('Managed gateway reconciliation failed:', err instanceof Error ? err.message : 'Unknown error');
      });
    }, 5 * 60 * 1000);

    setInterval(() => {
      runIfLeader('scheduler', async () => {
        await autoscalerService.evaluateScaling();
      }).catch((err) => {
        logger.error('Auto-scaling evaluation failed:', err instanceof Error ? err.message : 'Unknown error');
      });
    }, 30 * 1000);

    logger.info('[managed-gateway] Health check (30s), reconciliation (5m), and auto-scaling (30s) scheduled');
  }

  // Cleanup expired external shares every hour
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      await cleanupExpiredShares();
    }).catch((err) => {
      logger.error('Failed to cleanup expired external shares:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 60 * 60 * 1000);

  // Cleanup expired refresh tokens every hour
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      await cleanupExpiredTokens();
    }).catch((err) => {
      logger.error('Failed to cleanup expired refresh tokens:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 60 * 60 * 1000);

  // Cleanup token families that exceeded absolute session timeout (every 5 minutes)
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      await cleanupAbsolutelyTimedOutFamilies();
    }).catch((err) => {
      logger.error('Absolute timeout family cleanup failed:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 5 * 60 * 1000);

  // Check for expiring secrets every 6 hours
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      await checkExpiringSecrets();
    }).catch((err) => {
      logger.error('Secret expiry check failed:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 6 * 60 * 60 * 1000);

  // Mark idle sessions every minute
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      const count = await sessionService.markIdleSessions(config.sessionIdleThresholdMinutes);
      if (count > 0) logger.info(`Marked ${count} session(s) as idle`);
    }).catch((err) => {
      logger.error('Failed to mark idle sessions:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 60 * 1000);

  // Close inactive sessions every minute
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      const count = await checkAndCloseInactiveSessions();
      if (count > 0) logger.info(`Session cleanup: closed ${count} inactive session(s)`);
    }).catch((err) => {
      logger.error('Session inactivity cleanup failed:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 60 * 1000);

  // Cleanup old closed sessions daily
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      const count = await sessionService.cleanupClosedSessions(config.sessionCleanupRetentionDays);
      if (count > 0) logger.info(`Cleaned up ${count} old closed session(s)`);
    }).catch((err) => {
      logger.error('Failed to cleanup closed sessions:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 24 * 60 * 60 * 1000);

  // Cleanup expired recordings daily
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      await cleanupExpiredRecordings();
    }).catch((err) => {
      logger.error('Recording cleanup failed:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 24 * 60 * 60 * 1000);

  // Cleanup idle RD Gateway tunnels every minute
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      await cleanupIdleTunnels(config.sessionInactivityTimeoutSeconds);
    }).catch((err) => {
      logger.error('RD Gateway tunnel cleanup failed:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 60 * 1000);

  // Cleanup expired device auth codes every 5 minutes
  setInterval(() => {
    runIfLeader('scheduler', async () => {
      await cleanupExpiredDeviceCodes();
    }).catch((err) => {
      logger.error('Device auth code cleanup failed:', err instanceof Error ? err.message : 'Unknown error');
    });
  }, 5 * 60 * 1000);


  // Setup guacamole-lite for RDP
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let guacServer: any = null;
  if (config.nodeEnv !== 'test') {
    try {
      // -----------------------------------------------------------------------
      // Monkey-patch GuacdClient to support TLS connections to guacd.
      // guacamole-lite uses Net.connect() (plain TCP) internally. When
      // GUACD_SSL=true, we replace the module export with a subclass that
      // upgrades the connection to TLS before the Guacamole handshake starts.
      // -----------------------------------------------------------------------
      if (config.guacdSsl) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tls = require('tls');
        const guacdClientPath = require.resolve('guacamole-lite/lib/GuacdClient');
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const OrigGuacdClient = require(guacdClientPath);

        const guacdTlsCa = config.guacdCaCert ? fs.readFileSync(config.guacdCaCert) : undefined;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        class TlsGuacdClient extends OrigGuacdClient {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          constructor(guacdOptions: any, ...rest: any[]) {
            super(guacdOptions, ...rest);

            // The parent created a plain TCP socket and attached listeners.
            // Destroy it immediately (before async connect fires) and replace
            // with a TLS socket.
            this.guacdConnection.removeAllListeners();
            this.guacdConnection.destroy();

            this.guacdConnection = tls.connect({
              host: guacdOptions.host,
              port: guacdOptions.port,
              ca: guacdTlsCa,
              rejectUnauthorized: !!guacdTlsCa,
            });

            this.guacdConnection.on('secureConnect', this.processConnectionOpen.bind(this));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.guacdConnection.on('data', (data: any) => {
              this.processReceivedData(data.toString());
            });
            this.guacdConnection.on('close', (hadError: boolean) => {
              this.close(hadError ? new Error('TLS connection closed unexpectedly') : undefined);
            });
            this.guacdConnection.on('error', (error: Error) => {
              this.emit('error', error);
              this.close(error);
            });
          }
        }

        require.cache[guacdClientPath]!.exports = TlsGuacdClient;
        logger.info('[tls] GuacdClient patched to use TLS connections to guacd');
      }

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

      const guacTlsServer = https.createServer(serverTlsOptions);
      guacServer = new GuacamoleLite(
        { server: guacTlsServer },
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
      guacTlsServer.listen(config.guacamoleWsPort, () => {
        logger.info(`Guacamole WSS server listening on port ${config.guacamoleWsPort}`);
      });

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
              logger.error('Failed to end session on guac close:', err instanceof Error ? err.message : 'Unknown error');
            });

            // Finalize recording if one was started
            if (metadata.recordingId) {
              completeGuacRecording(metadata.recordingId).catch((err: unknown) => {
                logger.error('Failed to complete recording on guac close:', err instanceof Error ? err.message : 'Unknown error');
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

    } catch (err) {
      logger.warn(
        'guacamole-lite not available. RDP connections will not work.',
        err instanceof Error ? err.message : err
      );
    }
  }

  server.listen(config.port, () => {
    logger.info(`HTTPS server running on port ${config.port}`);
    logger.info(`Environment: ${config.nodeEnv}`);
    markServerReady();

    // Publish server-ready event — event bus handles SSH key push with delay
    publishGatewayEvent(GatewayEventType.SERVER_READY, {
      tenantId: '*',
      gatewayId: '*',
    }).catch((err) => {
      logger.error('Failed to publish SERVER_READY event:', err instanceof Error ? err.message : 'Unknown error');
    });
  });

  // If the tunnel server is separate (TLS-enabled), start it on port+10
  if (tunnelServer !== server) {
    const tunnelPort = config.port + 10;
    tunnelServer.listen(tunnelPort, () => {
      logger.info(`[tunnel] TLS tunnel server listening on port ${tunnelPort}`);
    });
  }

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
      logger.error('Failed to close sessions on shutdown:', err instanceof Error ? err.message : 'Unknown error');
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

    if (tunnelServer !== server) {
      tunnelServer.close(() => {
        logger.info('[tunnel] TLS tunnel server closed.');
      });
    }

    server.close(() => {
      logger.info('HTTPS server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => logger.error('Fatal startup error:', err instanceof Error ? err.message : 'Unknown error'));
