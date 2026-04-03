import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Account, LoginResult, TenantMembership } from '../types';
import { sendMessage } from '../lib/apiClient';
import { fetchAccounts } from '../lib/fetchAccounts';
import { logoutAccount } from '../lib/auth';
import {
  getAcceptedTenantMemberships,
  getPreferredTenantMembership,
} from '../lib/authFlow';
import { AccountSwitcher } from './AccountSwitcher';
import { VaultStatus } from './VaultStatus';
import { TabPanel } from './TabPanel';
import { LoginPage } from './pages/LoginPage';
import { MfaPage } from './pages/MfaPage';
import { TenantPickerPage } from './pages/TenantPickerPage';
import './popup.css';

type Tab = 'keychain' | 'connections';

type PopupView =
  | { page: 'main' }
  | { page: 'login' }
  | { page: 'mfa'; serverUrl: string; email: string; tempToken: string; methods: string[]; requiresTOTP: boolean }
  | { page: 'tenant-picker'; accountId: string; memberships: TenantMembership[] };

export function PopupApp(): React.ReactElement {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('keychain');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<PopupView>({ page: 'main' });
  const mountedRef = useRef(true);

  const reloadAccounts = useCallback(async () => {
    const { accounts: accts, activeId } = await fetchAccounts();
    if (!mountedRef.current) return;
    setAccounts(accts);
    setActiveAccountId(activeId);
  }, []);

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

  const handleLogout = useCallback(async (accountId: string) => {
    await logoutAccount(accountId);
    await reloadAccounts();
    setView({ page: 'main' });
  }, [reloadAccounts]);

  const handleLoginComplete = useCallback(async (result: LoginResult) => {
    await reloadAccounts();
    const memberships = getAcceptedTenantMemberships(result.tenantMemberships);
    const preferredMembership = getPreferredTenantMembership(memberships);

    if (result.accountId && memberships.length >= 2 && preferredMembership) {
      setView({
        page: 'tenant-picker',
        accountId: result.accountId,
        memberships,
      });
      return;
    }

    setView({ page: 'main' });
  }, [reloadAccounts]);

  const handleMfaRequired = useCallback((
    serverUrl: string,
    email: string,
    tempToken: string,
    methods: string[],
    requiresTOTP: boolean,
  ) => {
    setView({ page: 'mfa', serverUrl, email, tempToken, methods, requiresTOTP });
  }, []);

  const handleMfaSetupRequired = useCallback((serverUrl: string) => {
    // Open the Arsenale web UI in a new tab for MFA setup
    const normalized = serverUrl.includes('://') ? serverUrl : `https://${serverUrl}`;
    chrome.tabs.create({ url: `${normalized.replace(/\/+$/, '')}/login` });
    // Stay on main view
  }, []);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;

  if (loading) {
    return (
      <div className="popup-container">
        <div className="popup-loading">Loading...</div>
      </div>
    );
  }

  // Login page
  if (view.page === 'login') {
    return (
      <div className="popup-container">
        <LoginPage
          onMfaRequired={handleMfaRequired}
          onMfaSetupRequired={handleMfaSetupRequired}
          onSuccess={handleLoginComplete}
        />
      </div>
    );
  }

  // MFA page
  if (view.page === 'mfa') {
    return (
      <div className="popup-container">
        <MfaPage
          serverUrl={view.serverUrl}
          email={view.email}
          tempToken={view.tempToken}
          methods={view.methods}
          requiresTOTP={view.requiresTOTP}
          onSuccess={handleLoginComplete}
          onCancel={() => setView({ page: 'login' })}
        />
      </div>
    );
  }

  // Tenant picker
  if (view.page === 'tenant-picker') {
    return (
      <div className="popup-container">
        <TenantPickerPage
          accountId={view.accountId}
          memberships={view.memberships}
          onSelect={async () => {
            await reloadAccounts();
            setView({ page: 'main' });
          }}
          onSkip={() => setView({ page: 'main' })}
        />
      </div>
    );
  }

  // No accounts — show welcome + login
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
          <button className="btn btn-primary" onClick={() => setView({ page: 'login' })}>
            Sign In
          </button>
          <button className="btn btn-ghost" onClick={handleOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  // Session expired banner
  const expiredAccount = activeAccount?.sessionExpired ? activeAccount : null;

  return (
    <div className="popup-container">
      {expiredAccount && (
        <div className="session-expired-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Session expired</span>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setView({ page: 'login' })}
          >
            Re-login
          </button>
        </div>
      )}

      <header className="popup-header">
        <AccountSwitcher
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSwitch={handleSwitchAccount}
        />
        <button
          className="btn btn-icon"
          onClick={() => setView({ page: 'login' })}
          title="Add Account"
          aria-label="Add Account"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
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
        {activeAccount && (
          <button
            className="btn btn-icon"
            onClick={() => handleLogout(activeAccount.id)}
            title="Logout"
            aria-label="Logout"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        )}
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
