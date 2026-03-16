import React from 'react';
import type { Account } from '../types';

interface TabPanelProps {
  tab: 'keychain' | 'connections';
  account: Account | null;
}

export function TabPanel({ tab, account }: TabPanelProps): React.ReactElement {
  if (!account) {
    return (
      <div className="tab-panel">
        <p className="tab-placeholder">Select an account to continue.</p>
      </div>
    );
  }

  if (tab === 'keychain') {
    return (
      <div className="tab-panel">
        <div className="tab-placeholder-section">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="10" r="3" />
            <path d="M12 13v8" />
            <path d="M9 18h6" />
          </svg>
          <h3>Keychain</h3>
          <p>
            Browse and autofill credentials stored in your Arsenale vault.
          </p>
          <span className="coming-soon">Coming soon</span>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-panel">
      <div className="tab-placeholder-section">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
        <h3>Connections</h3>
        <p>
          View and launch SSH/RDP connections from your Arsenale server.
        </p>
        <span className="coming-soon">Coming soon</span>
      </div>
    </div>
  );
}
