import crypto from 'crypto';
import { config } from '../config';

export interface RdpConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Derive the AES-256-CBC key from the guacamole secret.
 * Must match the key passed to guacamole-lite in index.ts.
 */
export function getGuacamoleKey(): Buffer {
  return crypto.createHash('sha256').update(config.guacamoleSecret).digest();
}

/**
 * Generate an encrypted token for guacamole-lite.
 * Format: base64(JSON({ iv: base64, value: base64 }))
 * This matches guacamole-lite's decryptToken() expectations.
 */
export function generateGuacamoleToken(params: RdpConnectionParams): string {
  const connectionConfig = {
    connection: {
      type: 'rdp',
      settings: {
        hostname: params.host,
        port: String(params.port),
        username: params.username,
        password: params.password,
        security: 'nla',
        'ignore-cert': 'true',
        'enable-wallpaper': 'false',
        'enable-theming': 'true',
        'enable-font-smoothing': 'true',
        'resize-method': 'display-update',
      },
    },
  };

  const data = JSON.stringify(connectionConfig);
  const iv = crypto.randomBytes(16);
  const key = getGuacamoleKey();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // guacamole-lite expects: base64(JSON({ iv: base64, value: base64 }))
  const tokenObj = {
    iv: iv.toString('base64'),
    value: encrypted,
  };

  return Buffer.from(JSON.stringify(tokenObj)).toString('base64');
}
