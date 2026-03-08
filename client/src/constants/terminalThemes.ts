import type { ITerminalOptions, ITheme } from '@xterm/xterm';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface SshTerminalConfig {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  cursorStyle?: 'block' | 'underline' | 'bar';
  cursorBlink?: boolean;
  theme?: string;
  customColors?: Partial<TerminalThemeColors>;
  scrollback?: number;
  bellStyle?: 'none' | 'sound' | 'visual';
  syncThemeWithWebUI?: boolean;
  syncLightTheme?: string;
  syncDarkTheme?: string;
}

// ── Font families ──────────────────────────────────────────────────────────

export const FONT_FAMILIES = [
  { label: 'Menlo', value: 'Menlo, Monaco, "Courier New", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Cascadia Code', value: '"Cascadia Code", monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'System Monospace', value: 'monospace' },
] as const;

// ── Defaults ───────────────────────────────────────────────────────────────

export const TERMINAL_DEFAULTS: Required<Omit<SshTerminalConfig, 'customColors'>> & {
  customColors: TerminalThemeColors;
} = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 14,
  lineHeight: 1.0,
  letterSpacing: 0,
  cursorStyle: 'block',
  cursorBlink: true,
  theme: 'default-dark',
  customColors: {
    background: '#1a1a2e',
    foreground: '#e0e0e0',
    cursor: '#2196f3',
    selectionBackground: '#3a3a5e',
    black: '#000000',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },
  scrollback: 1000,
  bellStyle: 'none',
  syncThemeWithWebUI: false,
  syncLightTheme: 'solarized-light',
  syncDarkTheme: 'default-dark',
};

// ── Theme presets ──────────────────────────────────────────────────────────

export const THEME_PRESETS: Record<string, TerminalThemeColors> = {
  'default-dark': { ...TERMINAL_DEFAULTS.customColors },

  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },

  'solarized-dark': {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },

  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    selectionBackground: '#eee8d5',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },

  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    selectionBackground: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },

  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selectionBackground: '#434c5e',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },

  'one-dark': {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    selectionBackground: '#3e4451',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },

  gruvbox: {
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    selectionBackground: '#3c3836',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },

  'github-dark': {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#c9d1d9',
    selectionBackground: '#264f78',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },

  'github-light': {
    background: '#ffffff',
    foreground: '#24292f',
    cursor: '#044289',
    selectionBackground: '#accef7',
    black: '#24292f',
    red: '#cf222e',
    green: '#116329',
    yellow: '#4d2d00',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#1a7f37',
    brightYellow: '#633c01',
    brightBlue: '#218bff',
    brightMagenta: '#a475f9',
    brightCyan: '#3192aa',
    brightWhite: '#8c959f',
  },

  'catppuccin-latte': {
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    selectionBackground: '#acb0be',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#40a02b',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#8839ef',
    cyan: '#179299',
    white: '#acb0be',
    brightBlack: '#6c6f85',
    brightRed: '#d20f39',
    brightGreen: '#40a02b',
    brightYellow: '#df8e1d',
    brightBlue: '#1e66f5',
    brightMagenta: '#8839ef',
    brightCyan: '#179299',
    brightWhite: '#bcc0cc',
  },

  'one-light': {
    background: '#fafafa',
    foreground: '#383a42',
    cursor: '#526fff',
    selectionBackground: '#e5e5e6',
    black: '#383a42',
    red: '#e45649',
    green: '#50a14f',
    yellow: '#c18401',
    blue: '#4078f2',
    magenta: '#a626a4',
    cyan: '#0184bc',
    white: '#a0a1a7',
    brightBlack: '#696c77',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },

  'ayu-light': {
    background: '#fafafa',
    foreground: '#575f66',
    cursor: '#ff6a00',
    selectionBackground: '#d1e4f4',
    black: '#000000',
    red: '#f07171',
    green: '#86b300',
    yellow: '#f2ae49',
    blue: '#399ee6',
    magenta: '#a37acc',
    cyan: '#4cbf99',
    white: '#abb0b6',
    brightBlack: '#828c99',
    brightRed: '#f07171',
    brightGreen: '#86b300',
    brightYellow: '#f2ae49',
    brightBlue: '#399ee6',
    brightMagenta: '#a37acc',
    brightCyan: '#4cbf99',
    brightWhite: '#fafafa',
  },

  'everforest-light': {
    background: '#fdf6e3',
    foreground: '#5c6a72',
    cursor: '#5c6a72',
    selectionBackground: '#eaedc8',
    black: '#5c6a72',
    red: '#f85552',
    green: '#8da101',
    yellow: '#dfa000',
    blue: '#3a94c5',
    magenta: '#df69ba',
    cyan: '#35a77c',
    white: '#dfddc8',
    brightBlack: '#829181',
    brightRed: '#f85552',
    brightGreen: '#8da101',
    brightYellow: '#dfa000',
    brightBlue: '#3a94c5',
    brightMagenta: '#df69ba',
    brightCyan: '#35a77c',
    brightWhite: '#fdf6e3',
  },

  'rose-pine-dawn': {
    background: '#faf4ed',
    foreground: '#575279',
    cursor: '#cecacd',
    selectionBackground: '#dfdad9',
    black: '#f2e9e1',
    red: '#b4637a',
    green: '#286983',
    yellow: '#ea9d34',
    blue: '#56949f',
    magenta: '#907aa9',
    cyan: '#d7827e',
    white: '#575279',
    brightBlack: '#9893a5',
    brightRed: '#b4637a',
    brightGreen: '#286983',
    brightYellow: '#ea9d34',
    brightBlue: '#56949f',
    brightMagenta: '#907aa9',
    brightCyan: '#d7827e',
    brightWhite: '#575279',
  },

  'tokyo-night-light': {
    background: '#d5d6db',
    foreground: '#343b59',
    cursor: '#343b59',
    selectionBackground: '#9699a3',
    black: '#0f0f14',
    red: '#8c4351',
    green: '#33635c',
    yellow: '#8f5e15',
    blue: '#34548a',
    magenta: '#5a4a78',
    cyan: '#0f4b6e',
    white: '#343b59',
    brightBlack: '#9699a3',
    brightRed: '#8c4351',
    brightGreen: '#33635c',
    brightYellow: '#8f5e15',
    brightBlue: '#34548a',
    brightMagenta: '#5a4a78',
    brightCyan: '#0f4b6e',
    brightWhite: '#343b59',
  },

  'gruvbox-light': {
    background: '#fbf1c7',
    foreground: '#3c3836',
    cursor: '#3c3836',
    selectionBackground: '#ebdbb2',
    black: '#3c3836',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#7c6f64',
    brightBlack: '#928374',
    brightRed: '#9d0006',
    brightGreen: '#79740e',
    brightYellow: '#b57614',
    brightBlue: '#076678',
    brightMagenta: '#8f3f71',
    brightCyan: '#427b58',
    brightWhite: '#3c3836',
  },

  'catppuccin-mocha': {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#45475a',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },

  'tokyo-night': {
    background: '#1a1b26',
    foreground: '#a9b1d6',
    cursor: '#c0caf5',
    selectionBackground: '#33467c',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  },

  'night-owl': {
    background: '#011627',
    foreground: '#d6deeb',
    cursor: '#80a4c2',
    selectionBackground: '#1d3b53',
    black: '#011627',
    red: '#ef5350',
    green: '#22da6e',
    yellow: '#addb67',
    blue: '#82aaff',
    magenta: '#c792ea',
    cyan: '#21c7a8',
    white: '#ffffff',
    brightBlack: '#575656',
    brightRed: '#ef5350',
    brightGreen: '#22da6e',
    brightYellow: '#ffeb95',
    brightBlue: '#82aaff',
    brightMagenta: '#c792ea',
    brightCyan: '#7fdbca',
    brightWhite: '#ffffff',
  },

  kanagawa: {
    background: '#1f1f28',
    foreground: '#dcd7ba',
    cursor: '#c8c093',
    selectionBackground: '#2d4f67',
    black: '#090618',
    red: '#c34043',
    green: '#76946a',
    yellow: '#c0a36e',
    blue: '#7e9cd8',
    magenta: '#957fb8',
    cyan: '#6a9589',
    white: '#c8c093',
    brightBlack: '#727169',
    brightRed: '#e82424',
    brightGreen: '#98bb6c',
    brightYellow: '#e6c384',
    brightBlue: '#7fb4ca',
    brightMagenta: '#938aa9',
    brightCyan: '#7aa89f',
    brightWhite: '#dcd7ba',
  },
};

export const THEME_PRESET_NAMES = Object.keys(THEME_PRESETS);

// ── Merge logic ────────────────────────────────────────────────────────────

export type MergedConfig = Required<Omit<SshTerminalConfig, 'customColors'>> & {
  customColors: TerminalThemeColors;
};

export function mergeTerminalConfig(
  userDefaults?: Partial<SshTerminalConfig> | null,
  connectionOverrides?: Partial<SshTerminalConfig> | null,
): MergedConfig {
  const merged: MergedConfig = { ...TERMINAL_DEFAULTS };

  // Layer 2: user defaults
  if (userDefaults) {
    for (const key of Object.keys(userDefaults) as (keyof SshTerminalConfig)[]) {
      if (key === 'customColors') continue;
      if (userDefaults[key] !== undefined) {
        (merged as Record<string, unknown>)[key] = userDefaults[key];
      }
    }
    if (userDefaults.customColors) {
      merged.customColors = { ...merged.customColors, ...userDefaults.customColors };
    }
  }

  // Layer 3: per-connection overrides
  if (connectionOverrides) {
    for (const key of Object.keys(connectionOverrides) as (keyof SshTerminalConfig)[]) {
      if (key === 'customColors') continue;
      if (connectionOverrides[key] !== undefined) {
        (merged as Record<string, unknown>)[key] = connectionOverrides[key];
      }
    }
    if (connectionOverrides.customColors) {
      merged.customColors = { ...merged.customColors, ...connectionOverrides.customColors };
    }
  }

  return merged;
}

// ── Convert to xterm.js options ────────────────────────────────────────────

export function resolveThemeForMode(
  config: MergedConfig,
  webUiMode: 'light' | 'dark',
): string {
  if (!config.syncThemeWithWebUI) return config.theme;
  return webUiMode === 'light' ? config.syncLightTheme : config.syncDarkTheme;
}

export function toXtermOptions(
  config: MergedConfig,
  webUiMode?: 'light' | 'dark',
): ITerminalOptions {
  const effectiveTheme = webUiMode
    ? resolveThemeForMode(config, webUiMode)
    : config.theme;

  const colors: TerminalThemeColors =
    effectiveTheme === 'custom'
      ? config.customColors
      : THEME_PRESETS[effectiveTheme] ?? THEME_PRESETS['default-dark'];

  const theme: ITheme = {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.cursor,
    selectionBackground: colors.selectionBackground,
    black: colors.black,
    red: colors.red,
    green: colors.green,
    yellow: colors.yellow,
    blue: colors.blue,
    magenta: colors.magenta,
    cyan: colors.cyan,
    white: colors.white,
    brightBlack: colors.brightBlack,
    brightRed: colors.brightRed,
    brightGreen: colors.brightGreen,
    brightYellow: colors.brightYellow,
    brightBlue: colors.brightBlue,
    brightMagenta: colors.brightMagenta,
    brightCyan: colors.brightCyan,
    brightWhite: colors.brightWhite,
  };

  return {
    fontFamily: config.fontFamily,
    fontSize: config.fontSize,
    lineHeight: config.lineHeight,
    letterSpacing: config.letterSpacing,
    cursorStyle: config.cursorStyle,
    cursorBlink: config.cursorBlink,
    scrollback: config.scrollback,
    theme,
  };
}
