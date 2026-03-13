import { createTheme, type Theme } from '@mui/material';

export type ThemeMode = 'light' | 'dark';

const shared = {
  typography: {
    fontFamily: 'Roboto, sans-serif',
  },
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
  },
};

export const darkTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#2196f3' },
    secondary: { main: '#ff9800' },
    background: {
      default: '#1a1a2e',
      paper: '#16213e',
    },
  },
});

export const lightTheme: Theme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    secondary: { main: '#f57c00' },
    background: {
      default: '#f5f5f5',
      paper: '#ffffff',
    },
  },
});

export const themes: Record<ThemeMode, Theme> = { light: lightTheme, dark: darkTheme };
