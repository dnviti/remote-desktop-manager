import { Dialog, DialogContent, CssBaseline, Menu, MenuItem, ThemeProvider } from '@mui/material';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { themes } from './index';

describe('shared dialog theme overrides', () => {
  it('disables pointer events as soon as a dialog begins closing', async () => {
    const view = render(
      <ThemeProvider theme={themes.primer.dark}>
        <CssBaseline />
        <Dialog open transitionDuration={1000}>
          <DialogContent>Dialog body</DialogContent>
        </Dialog>
      </ThemeProvider>,
    );

    await vi.waitFor(() => {
      expect(document.body.querySelector('.MuiDialog-root')).toBeInTheDocument();
    });

    view.rerender(
      <ThemeProvider theme={themes.primer.dark}>
        <CssBaseline />
        <Dialog open={false} transitionDuration={1000}>
          <DialogContent>Dialog body</DialogContent>
        </Dialog>
      </ThemeProvider>,
    );

    await vi.waitFor(() => {
      const root = document.body.querySelector('.MuiDialog-root');
      expect(root).not.toBeNull();
      expect(window.getComputedStyle(root as Element).pointerEvents).toBe('none');
    });
  });

  it('disables pointer events as soon as a menu begins closing', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    const view = render(
      <ThemeProvider theme={themes.primer.dark}>
        <CssBaseline />
        <Menu open anchorEl={anchor} transitionDuration={1000}>
          <MenuItem>Example</MenuItem>
        </Menu>
      </ThemeProvider>,
    );

    await vi.waitFor(() => {
      expect(document.body.querySelector('.MuiMenu-root')).toBeInTheDocument();
    });

    view.rerender(
      <ThemeProvider theme={themes.primer.dark}>
        <CssBaseline />
        <Menu open={false} anchorEl={anchor} transitionDuration={1000}>
          <MenuItem>Example</MenuItem>
        </Menu>
      </ThemeProvider>,
    );

    await vi.waitFor(() => {
      const root = document.body.querySelector('.MuiMenu-root');
      expect(root).not.toBeNull();
      expect(window.getComputedStyle(root as Element).pointerEvents).toBe('none');
    });

    anchor.remove();
  });
});
