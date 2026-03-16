import React from 'react';
import ReactDOM from 'react-dom/client';
import { PopupApp } from './PopupApp';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- standard React entry point pattern
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
);
