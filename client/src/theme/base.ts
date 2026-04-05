import type { Theme, ThemeOptions } from '@mui/material';

/**
 * Shared MUI component overrides used by all themes.
 * Each theme merges these with its own palette and typography.
 */
const ignorePointerEventsWhenClosed = (ownerState: { open?: boolean }) => ({
  // Closing overlays can remain mounted briefly while their exit transition runs.
  // They must stop intercepting clicks as soon as `open` flips to false.
  pointerEvents: ownerState.open === false ? ('none' as const) : ('auto' as const),
});

export const sharedComponents: ThemeOptions['components'] = {
  MuiCssBaseline: {
    styleOverrides: (themeParam: Theme) => ({
      ':root': {
        '--arsenale-accent': themeParam.palette.primary.main,
        '--arsenale-bg': themeParam.palette.background.default,
        '--arsenale-border': themeParam.palette.divider,
        '--arsenale-muted': themeParam.palette.text.disabled,
      },
      '.MuiAppBar-root, .MuiToolbar-root, .MuiTabs-root, .MuiTab-root, .MuiDrawer-root': {
        userSelect: 'none',
      },
      'input, textarea, [contenteditable="true"]': {
        userSelect: 'text',
      },
    }),
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
  MuiModal: {
    styleOverrides: {
      root: ({ ownerState }: { ownerState: { open?: boolean } }) =>
        ignorePointerEventsWhenClosed(ownerState),
    },
  },
  MuiDialog: {
    styleOverrides: {
      root: ({ ownerState }: { ownerState: { open?: boolean } }) =>
        ignorePointerEventsWhenClosed(ownerState),
      paper: {
        backgroundImage: 'none',
        borderRadius: 16,
        boxShadow: 'none',
      },
    },
  },
  MuiPopover: {
    styleOverrides: {
      root: ({ ownerState }: { ownerState: { open?: boolean } }) =>
        ignorePointerEventsWhenClosed(ownerState),
    },
  },
  MuiMenu: {
    styleOverrides: {
      root: ({ ownerState }: { ownerState: { open?: boolean } }) =>
        ignorePointerEventsWhenClosed(ownerState),
    },
  },
  MuiDrawer: {
    styleOverrides: {
      root: ({ ownerState }: { ownerState: { open?: boolean } }) =>
        ignorePointerEventsWhenClosed(ownerState),
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
};

export const sharedShape = { borderRadius: 12 };
