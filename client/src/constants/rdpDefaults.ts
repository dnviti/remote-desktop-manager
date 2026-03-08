// ── Types ──────────────────────────────────────────────────────────────────

export interface RdpSettings {
  colorDepth?: 8 | 16 | 24;
  width?: number;
  height?: number;
  dpi?: number;
  resizeMethod?: 'display-update' | 'reconnect';
  qualityPreset?: 'performance' | 'balanced' | 'quality' | 'custom';
  enableWallpaper?: boolean;
  enableTheming?: boolean;
  enableFontSmoothing?: boolean;
  enableFullWindowDrag?: boolean;
  enableDesktopComposition?: boolean;
  enableMenuAnimations?: boolean;
  forceLossless?: boolean;
  disableAudio?: boolean;
  enableAudioInput?: boolean;
  security?: 'any' | 'nla' | 'nla-ext' | 'tls' | 'rdp';
  ignoreCert?: boolean;
  serverLayout?: string;
  console?: boolean;
  timezone?: string;
}

// ── Quality presets ───────────────────────────────────────────────────────

type QualityFields = Pick<
  Required<RdpSettings>,
  'enableWallpaper' | 'enableTheming' | 'enableFontSmoothing' | 'enableFullWindowDrag' | 'enableDesktopComposition' | 'enableMenuAnimations' | 'forceLossless'
>;

export const QUALITY_PRESETS: Record<string, QualityFields> = {
  performance: {
    enableWallpaper: false,
    enableTheming: false,
    enableFontSmoothing: false,
    enableFullWindowDrag: false,
    enableDesktopComposition: false,
    enableMenuAnimations: false,
    forceLossless: false,
  },
  balanced: {
    enableWallpaper: false,
    enableTheming: true,
    enableFontSmoothing: true,
    enableFullWindowDrag: false,
    enableDesktopComposition: false,
    enableMenuAnimations: false,
    forceLossless: false,
  },
  quality: {
    enableWallpaper: true,
    enableTheming: true,
    enableFontSmoothing: true,
    enableFullWindowDrag: true,
    enableDesktopComposition: true,
    enableMenuAnimations: true,
    forceLossless: false,
  },
};

// ── Defaults ──────────────────────────────────────────────────────────────

export const RDP_DEFAULTS: Required<
  Omit<RdpSettings, 'colorDepth' | 'width' | 'height' | 'serverLayout' | 'timezone'>
> = {
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

// ── Keyboard layouts ──────────────────────────────────────────────────────

export const KEYBOARD_LAYOUTS = [
  { label: 'English (US)', value: 'en-us-qwerty' },
  { label: 'Italian', value: 'it-it-qwerty' },
  { label: 'German', value: 'de-de-qwertz' },
  { label: 'French', value: 'fr-fr-azerty' },
  { label: 'Spanish', value: 'es-es-qwerty' },
  { label: 'Portuguese (BR)', value: 'pt-br-qwerty' },
  { label: 'Japanese', value: 'ja-jp-qwerty' },
  { label: 'Swedish', value: 'sv-se-qwerty' },
  { label: 'Norwegian', value: 'no-no-qwerty' },
  { label: 'Danish', value: 'da-dk-qwerty' },
  { label: 'Swiss (French)', value: 'fr-ch-qwertz' },
  { label: 'Swiss (German)', value: 'de-ch-qwertz' },
  { label: 'UK English', value: 'en-gb-qwerty' },
] as const;

// ── Common timezones ──────────────────────────────────────────────────────

export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Moscow',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

// ── Merge logic ───────────────────────────────────────────────────────────

export function mergeRdpConfig(
  userDefaults?: Partial<RdpSettings> | null,
  connectionOverrides?: Partial<RdpSettings> | null,
): RdpSettings {
  const merged: RdpSettings = { ...RDP_DEFAULTS };

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
