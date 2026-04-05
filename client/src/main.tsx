/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import { useThemeStore } from './store/themeStore';
import { themes } from './theme/index';
import './fonts';
import './global.css';

function Root() {
  const themeName = useThemeStore((s) => s.themeName);
  const mode = useThemeStore((s) => s.mode);

  return (
    <ThemeProvider theme={themes[themeName][mode]}>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- standard React entry point pattern
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
