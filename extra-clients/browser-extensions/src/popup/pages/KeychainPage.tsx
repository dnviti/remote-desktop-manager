import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Account, SecretListItem, VaultStatusResponse } from '../../types';
import { getVaultStatus } from '../../lib/vaultApi';
import { sendMessage } from '../../lib/apiClient';
import { VaultUnlockForm } from '../components/VaultUnlockForm';
import { SecretList } from '../components/SecretList';
import { SecretDetail } from '../components/SecretDetail';

interface KeychainPageProps {
  account: Account;
}

type KeychainView =
  | { view: 'loading' }
  | { view: 'locked'; vaultStatus: VaultStatusResponse }
  | { view: 'list' }
  | { view: 'detail'; secret: SecretListItem };

export function KeychainPage({ account }: KeychainPageProps): React.ReactElement {
  const [currentView, setCurrentView] = useState<KeychainView>({ view: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const checkVaultStatus = useCallback(async () => {
    setError(null);
    const res = await getVaultStatus(account.id);
    if (!mountedRef.current) return;

    if (res.success && res.data) {
      if (res.data.unlocked) {
        // Update account's vaultUnlocked flag in chrome.storage
        void sendMessage({
          type: 'UPDATE_ACCOUNT',
          account: { id: account.id, vaultUnlocked: true },
        });
        setCurrentView({ view: 'list' });
      } else {
        void sendMessage({
          type: 'UPDATE_ACCOUNT',
          account: { id: account.id, vaultUnlocked: false },
        });
        setCurrentView({ view: 'locked', vaultStatus: res.data });
      }
    } else {
      setError(res.error ?? 'Failed to check vault status');
      setCurrentView({ view: 'locked', vaultStatus: { unlocked: false, mfaUnlockAvailable: false, mfaUnlockMethods: [] } });
    }
  }, [account.id]);

  useEffect(() => {
    mountedRef.current = true;
    checkVaultStatus().catch(() => { /* handled inside */ });
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const handleUnlocked = useCallback(() => {
    void sendMessage({
      type: 'UPDATE_ACCOUNT',
      account: { id: account.id, vaultUnlocked: true },
    });
    setCurrentView({ view: 'list' });
  }, [account.id]);

  const handleVaultLocked = useCallback(() => {
    void sendMessage({
      type: 'UPDATE_ACCOUNT',
      account: { id: account.id, vaultUnlocked: false },
    });
    void checkVaultStatus();
  }, [account.id, checkVaultStatus]);

  const handleSelectSecret = useCallback((secret: SecretListItem) => {
    setCurrentView({ view: 'detail', secret });
  }, []);

  const handleBackToList = useCallback(() => {
    setCurrentView({ view: 'list' });
  }, []);

  if (currentView.view === 'loading') {
    return (
      <div className="keychain-page">
        <div className="keychain-loading">Checking vault status...</div>
      </div>
    );
  }

  if (error && currentView.view !== 'locked') {
    return (
      <div className="keychain-page">
        <div className="keychain-error">
          <p className="form-error">{error}</p>
          <button className="btn btn-ghost btn-xs" onClick={checkVaultStatus}>Retry</button>
        </div>
      </div>
    );
  }

  if (currentView.view === 'locked') {
    return (
      <div className="keychain-page">
        <VaultUnlockForm
          accountId={account.id}
          vaultStatus={currentView.vaultStatus}
          onUnlocked={handleUnlocked}
        />
      </div>
    );
  }

  if (currentView.view === 'detail') {
    return (
      <div className="keychain-page">
        <SecretDetail
          accountId={account.id}
          secret={currentView.secret}
          onBack={handleBackToList}
          onVaultLocked={handleVaultLocked}
        />
      </div>
    );
  }

  // list view
  return (
    <div className="keychain-page">
      <SecretList
        accountId={account.id}
        onSelect={handleSelectSecret}
        onVaultLocked={handleVaultLocked}
      />
    </div>
  );
}
