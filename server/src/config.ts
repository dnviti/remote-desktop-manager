import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  guacamoleWsPort: parseInt(process.env.GUACAMOLE_WS_PORT || '3002', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  guacdHost: process.env.GUACD_HOST || 'localhost',
  guacdPort: parseInt(process.env.GUACD_PORT || '4822', 10),
  guacamoleSecret: process.env.GUACAMOLE_SECRET || 'dev-guac-secret',
  vaultTtlMinutes: parseInt(process.env.VAULT_TTL_MINUTES || '30', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};
