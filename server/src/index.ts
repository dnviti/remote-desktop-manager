import http from 'http';
import app from './app';
import { config } from './config';
import { setupSocketIO } from './socket';
import { logger, toGuacamoleLogLevel } from './utils/logger';
import prisma from './lib/prisma';

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
  await runStartupMigrations();

  const server = http.createServer(app);

  // Setup Socket.io for SSH
  setupSocketIO(server);

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
  });
}

main().catch((err) => logger.error(err));
