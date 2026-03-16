import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Account } from '../types';
import { sendMessage } from '../lib/apiClient';
import { AccountSwitcher } from './AccountSwitcher';
import { VaultStatus } from './VaultStatus';
import { TabPanel } from './TabPanel';
import './popup.css';

type Tab = 'keychain' | 'connections';

async function fetchAccounts(): Promise<{ accounts: Account[]; activeId: string | null }> {
  const res = await sendMessage<Account[]>({ type: 'GET_ACCOUNTS' });
  const accounts = res.success && res.data ? res.data : [];
  const storage = await chrome.storage.local.get('activeAccountId');
  const activeId = (storage['activeAccountId'] as string | null | undefined) ?? null;
  return { accounts, activeId };
}

export function PopupApp(): React.ReactElement {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('keychain');
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetchAccounts().then(({ accounts: accts, activeId }) => {
      if (!mountedRef.current) return;
      setAccounts(accts);
      setActiveAccountId(activeId);
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current) return;
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, []);

  const handleSwitchAccount = useCallback(async (id: string) => {
    await sendMessage({ type: 'SET_ACTIVE_ACCOUNT', accountId: id });
    setActiveAccountId(id);
  }, []);

  const handleOpenSettings = useCallback(() => {
    void chrome.runtime.openOptionsPage();
  }, []);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;

  if (loading) {
    return (
      <div className="popup-container">
        <div className="popup-loading">Loading...</div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="popup-container">
        <div className="popup-empty">
          <div className="popup-empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </div>
          <h2>Welcome to Arsenale</h2>
          <p>Add a server account to get started.</p>
          <button className="btn btn-primary" onClick={handleOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <header className="popup-header">
        <AccountSwitcher
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSwitch={handleSwitchAccount}
        />
        <button
          className="btn btn-icon"
          onClick={handleOpenSettings}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>
      </header>

      {activeAccount && <VaultStatus account={activeAccount} />}

      <nav className="popup-tabs">
        <button
          className={`popup-tab ${activeTab === 'keychain' ? 'active' : ''}`}
          onClick={() => setActiveTab('keychain')}
        >
          Keychain
        </button>
        <button
          className={`popup-tab ${activeTab === 'connections' ? 'active' : ''}`}
          onClick={() => setActiveTab('connections')}
        >
          Connections
        </button>
      </nav>

      <TabPanel tab={activeTab} account={activeAccount} />
    </div>
  );
}
