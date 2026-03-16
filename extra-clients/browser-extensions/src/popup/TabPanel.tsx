import React from 'react';
import type { Account } from '../types';
import { KeychainPage } from './pages/KeychainPage';
import { ConnectionsPage } from './pages/ConnectionsPage';

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
        <KeychainPage account={account} />
      </div>
    );
  }

  return <ConnectionsPage account={account} />;
}
