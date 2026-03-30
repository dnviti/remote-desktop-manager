import crypto from 'crypto';
import type { VncSettings, ResolvedDlpPolicy } from '../types';
import { getGuacamoleKey } from './rdp.service';

export interface VncRecordingParams {
  recordingPath: string;
  recordingName: string;
}

export interface VncConnectionParams {
  host: string;
  port: number;
  password: string;
  vncSettings?: Partial<VncSettings>;
  guacdHost?: string;
  guacdPort?: number;
  dlpPolicy?: ResolvedDlpPolicy;
  recording?: VncRecordingParams;
  metadata?: {
    userId: string;
    connectionId: string;
    ipAddress?: string;
    recordingId?: string;
  };
}

/** Merge system defaults → connection overrides → tenant enforced */
export function mergeVncSettings(
  connectionOverrides?: Partial<VncSettings> | null,
  tenantEnforced?: Partial<VncSettings> | null,
): VncSettings {
  const systemDefaults: Required<Omit<VncSettings, 'colorDepth'>> = {
    cursor: 'local',
    readOnly: false,
    clipboardEncoding: 'UTF-8',
    swapRedBlue: false,
    disableAudio: true,
  };

  const merged: VncSettings = { ...systemDefaults };

  if (connectionOverrides) {
    for (const [k, v] of Object.entries(connectionOverrides)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
    }
  }

  if (tenantEnforced) {
    for (const [k, v] of Object.entries(tenantEnforced)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
    }
  }

  return merged;
}

/**
 * Build Guacamole/VNC connection settings.
 */
export function buildVncGuacamoleSettings(params: VncConnectionParams): Record<string, string> {
  const vnc = params.vncSettings ?? {};

  const settings: Record<string, string> = {
    hostname: params.host,
    port: String(params.port),
    password: params.password,
    cursor: vnc.cursor ?? 'local',
    'clipboard-encoding': vnc.clipboardEncoding ?? 'UTF-8',
  };

  if (vnc.colorDepth) settings['color-depth'] = String(vnc.colorDepth);
  if (vnc.readOnly) settings['read-only'] = 'true';
  if (vnc.swapRedBlue) settings['swap-red-blue'] = 'true';
  if (vnc.disableAudio === false) settings['enable-audio'] = 'true';

  if (params.recording) {
    settings['recording-path'] = params.recording.recordingPath;
    settings['recording-name'] = params.recording.recordingName;
    settings['create-recording-path'] = 'true';
    settings['recording-exclude-output'] = 'false';
    settings['recording-exclude-mouse'] = 'false';
  }

  if (params.dlpPolicy?.disableCopy) settings['disable-copy'] = 'true';
  if (params.dlpPolicy?.disablePaste) settings['disable-paste'] = 'true';

  return settings;
}

/**
 * Generate an encrypted token for guacamole-lite with VNC protocol.
 * Same encryption format as RDP — guacamole-lite handles both.
 */
export function generateVncGuacamoleToken(params: VncConnectionParams): string {
  const settings = buildVncGuacamoleSettings(params);

  const connectionConfig = {
    connection: {
      type: 'vnc',
      ...(params.guacdHost && { guacdHost: params.guacdHost }),
      ...(params.guacdPort && { guacdPort: params.guacdPort }),
      settings,
    },
    ...(params.metadata && { metadata: params.metadata }),
  };

  // guacamole-lite's Crypt.decrypt() outputs with 'ascii' encoding,
  // which corrupts any byte > 127. Escape non-ASCII chars to \uXXXX
  // so the plaintext is pure ASCII and survives the round-trip.
  const data = JSON.stringify(connectionConfig).replace(
    /[\u0080-\uffff]/g,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
  const iv = crypto.randomBytes(12); // GCM uses 12 bytes
  const key = getGuacamoleKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(data, 'utf8', 'binary');
  encrypted += cipher.final('binary');
  const tag = cipher.getAuthTag();

  const tokenObj = {
    iv: iv.toString('base64'),
    value: Buffer.from(encrypted, 'binary').toString('base64'),
    tag: tag.toString('base64'),
  };

  // Append '=' so base64 always has padding — prevents URL-appended chars
  // (from guacamole-common-js WebSocketTunnel) from being decoded as base64
  const b64 = Buffer.from(JSON.stringify(tokenObj)).toString('base64');
  return b64.endsWith('=') ? b64 : b64 + '=';
}
