import crypto from 'crypto';
import { config } from '../config';
import type { RdpSettings } from '../types';

export interface RecordingParams {
  recordingPath: string;
  recordingName: string;
}

export interface RdpConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
  domain?: string;
  enableDrive?: boolean;
  drivePath?: string;
  rdpSettings?: Partial<RdpSettings>;
  guacdHost?: string;
  guacdPort?: number;
  recording?: RecordingParams;
  metadata?: {
    userId: string;
    connectionId: string;
    ipAddress?: string;
    recordingId?: string;
  };
}

/**
 * Derive the AES-256-GCM key from the guacamole secret.
 * Must match the key passed to guacamole-lite in index.ts.
 */
export function getGuacamoleKey(): Buffer {
  // Use a static salt to derive a 32-byte key from the potentially weak secret
  // using scrypt for better protection against offline dictionary attacks.
  return crypto.scryptSync(config.guacamoleSecret, 'arsenale-guac-salt', 32, { N: 16384, r: 8, p: 1 });
}

/** Merge system defaults → user defaults → connection overrides */
export function mergeRdpSettings(
  userDefaults?: Partial<RdpSettings> | null,
  connectionOverrides?: Partial<RdpSettings> | null,
): RdpSettings {
  const systemDefaults: Required<Omit<RdpSettings, 'colorDepth' | 'width' | 'height' | 'serverLayout' | 'timezone'>> = {
    dpi: 96,
    resizeMethod: 'display-update',
    qualityPreset: 'balanced',
    enableWallpaper: false,
    enableTheming: true,
    enableFontSmoothing: true,
    enableFullWindowDrag: false,
    enableDesktopComposition: false,
    enableMenuAnimations: false,
    forceLossless: false,
    disableAudio: true,
    enableAudioInput: false,
    security: 'nla',
    ignoreCert: false,
    console: false,
  };

  const merged: RdpSettings = { ...systemDefaults };

  if (userDefaults) {
    for (const [k, v] of Object.entries(userDefaults)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
    }
  }

  if (connectionOverrides) {
    for (const [k, v] of Object.entries(connectionOverrides)) {
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
    }
  }

  return merged;
}

function boolStr(val: boolean | undefined, fallback: boolean): string {
  return (val ?? fallback) ? 'true' : 'false';
}

/**
 * Generate an encrypted token for guacamole-lite.
 * Format: base64(JSON({ iv: base64, value: base64 }))
 * This matches guacamole-lite's decryptToken() expectations.
 */
export function generateGuacamoleToken(params: RdpConnectionParams): string {
  const rdp = params.rdpSettings ?? {};

  const settings: Record<string, string> = {
    hostname: params.host,
    port: String(params.port),
    username: params.username,
    password: params.password,
    security: rdp.security ?? 'nla',
    'ignore-cert': boolStr(rdp.ignoreCert, false),
    'enable-wallpaper': boolStr(rdp.enableWallpaper, false),
    'enable-theming': boolStr(rdp.enableTheming, true),
    'enable-font-smoothing': boolStr(rdp.enableFontSmoothing, true),
    'enable-full-window-drag': boolStr(rdp.enableFullWindowDrag, false),
    'enable-desktop-composition': boolStr(rdp.enableDesktopComposition, false),
    'enable-menu-animations': boolStr(rdp.enableMenuAnimations, false),
    'force-lossless': boolStr(rdp.forceLossless, false),
    'resize-method': rdp.resizeMethod ?? 'display-update',
    'disable-audio': boolStr(rdp.disableAudio, true),
    'enable-audio-input': boolStr(rdp.enableAudioInput, false),
  };

  if (params.domain) settings.domain = params.domain;

  if (rdp.colorDepth) settings['color-depth'] = String(rdp.colorDepth);
  if (rdp.width) settings.width = String(rdp.width);
  if (rdp.height) settings.height = String(rdp.height);
  if (rdp.dpi) settings.dpi = String(rdp.dpi);
  if (rdp.serverLayout) settings['server-layout'] = rdp.serverLayout;
  if (rdp.console) settings.console = 'true';
  if (rdp.timezone) settings.timezone = rdp.timezone;

  if (params.recording) {
    settings['recording-path'] = params.recording.recordingPath;
    settings['recording-name'] = params.recording.recordingName;
    settings['create-recording-path'] = 'true';
    settings['recording-exclude-output'] = 'false';
    settings['recording-exclude-mouse'] = 'false';
    // Force legacy graphics pipeline — guacd cannot record the GFX/AVC444
    // channel used by modern Windows, resulting in a black screen recording.
    // Requires guacd >= 1.6.0 (GUACAMOLE-377).
    settings['disable-gfx'] = 'true';
    settings['enable-wallpaper'] = 'true';
    // Additional caching disables to force the classic graphics pipeline
    // even when disable-gfx alone is insufficient (older RDP servers/drivers).
    settings['disable-glyph-caching'] = 'true';
    settings['disable-bitmap-caching'] = 'true';
    settings['disable-offscreen-caching'] = 'true';
  }

  if (params.enableDrive && params.drivePath) {
    settings['enable-drive'] = 'true';
    settings['drive-name'] = 'Shared';
    settings['drive-path'] = params.drivePath;
    settings['create-drive-path'] = 'true';
  }

  const connectionConfig = {
    connection: {
      type: 'rdp',
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

  // guacamole-lite Crypt.decrypt() expects:
  //   value = base64( binary_ciphertext )
  //   iv    = base64( iv_bytes )
  // So we must encrypt to 'binary', then base64-encode that binary string.
  // We patched guacamole-lite to also support AES-256-GCM auth tags.
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
