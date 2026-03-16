import { createTheme, type Theme } from '@mui/material';

export type ThemeMode = 'light' | 'dark';

/* ─── Dark Editorial Precision — Design System Tokens ─── */
const editorial = {
  bg: '#08080a',
  raised: '#0f0f12',
  surface: '#161619',
  surfaceLight: '#1c1c20',
  border: '#232328',
  borderSubtle: '#1a1a1e',
  accent: '#00e5a0',
  accentDim: '#00cc8e',
  textPrimary: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#52525b',
};

const fonts = {
  sans: "'Outfit', system-ui, sans-serif",
  serif: "'Instrument Serif', Georgia, serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

const shared = {
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        '.MuiAppBar-root, .MuiToolbar-root, .MuiTabs-root, .MuiTab-root, .MuiDrawer-root': {
          userSelect: 'none',
        },
        'input, textarea, [contenteditable="true"]': {
          userSelect: 'text',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 600,
          borderRadius: 8,
          letterSpacing: '0.01em',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          borderRadius: 20,
        },
      },
    },
    MuiCard: {
      defaultProps: {
        variant: 'outlined' as const,
        elevation: 0,
      },
      styleOverrides: {
        root: {
          borderRadius: 12,
          backgroundImage: 'none',
          boxShadow: 'none',
        },
      },
    },
    MuiAccordion: {
      defaultProps: {
        variant: 'outlined' as const,
        elevation: 0,
        disableGutters: true,
      },
      styleOverrides: {
        root: {
          borderRadius: '12px !important',
          backgroundImage: 'none',
          boxShadow: 'none',
          '&:before': { display: 'none' },
          margin: '0 !important',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          borderRadius: 16,
          boxShadow: 'none',
        },
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 500,
          letterSpacing: '0.01em',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
};

export const darkTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: editorial.accent },
    secondary: { main: editorial.accentDim },
    background: {
      default: editorial.bg,
      paper: editorial.raised,
    },
    text: {
      primary: editorial.textPrimary,
      secondary: editorial.textSecondary,
      disabled: editorial.textMuted,
    },
    divider: editorial.border,
    success: { main: editorial.accent },
    error: { main: '#ef4444' },
    warning: { main: '#f59e0b' },
    info: { main: editorial.accent },
  },
  typography: {
    fontFamily: fonts.sans,
    h1: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.02em' },
    h2: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.02em' },
    h3: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.01em' },
    h4: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.01em' },
    h5: { fontFamily: fonts.serif, fontWeight: 400 },
    h6: { fontFamily: fonts.serif, fontWeight: 400 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    body1: { fontWeight: 400, lineHeight: 1.7 },
    body2: { fontWeight: 400, lineHeight: 1.6 },
    caption: { fontWeight: 500, letterSpacing: '0.04em' },
    overline: { fontWeight: 500, letterSpacing: '0.15em', fontSize: '0.6875rem' },
    button: { fontWeight: 600 },
  },
});

export const lightTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#059669' },
    secondary: { main: '#047857' },
    background: {
      default: '#f8fafb',
      paper: '#ffffff',
    },
    text: {
      primary: '#18181b',
      secondary: '#52525b',
      disabled: '#a1a1aa',
    },
    divider: '#e4e4e7',
    success: { main: '#059669' },
    error: { main: '#dc2626' },
    warning: { main: '#d97706' },
    info: { main: '#059669' },
  },
  typography: {
    fontFamily: fonts.sans,
    h1: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.02em' },
    h2: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.02em' },
    h3: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.01em' },
    h4: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '-0.01em' },
    h5: { fontFamily: fonts.serif, fontWeight: 400 },
    h6: { fontFamily: fonts.serif, fontWeight: 400 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    body1: { fontWeight: 400, lineHeight: 1.7 },
    body2: { fontWeight: 400, lineHeight: 1.6 },
    caption: { fontWeight: 500, letterSpacing: '0.04em' },
    overline: { fontWeight: 500, letterSpacing: '0.15em', fontSize: '0.6875rem' },
    button: { fontWeight: 600 },
  },
});

export const themes: Record<ThemeMode, Theme> = { light: lightTheme, dark: darkTheme };
