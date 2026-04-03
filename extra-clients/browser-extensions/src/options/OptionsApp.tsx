import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Account } from '../types';
import { sendMessage } from '../lib/apiClient';
import { fetchAccounts } from '../lib/fetchAccounts';
import { AccountList } from './AccountList';
import { AddAccountForm } from './AddAccountForm';
import { AutofillSettings } from './AutofillSettings';
import './options.css';

export function OptionsApp(): React.ReactElement {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [loading, setLoading] = useState(true);
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

  const handleRemove = useCallback(async (id: string) => {
    await sendMessage({ type: 'REMOVE_ACCOUNT', accountId: id });
    await reloadAccounts();
  }, [reloadAccounts]);

  const handleSetActive = useCallback(async (id: string) => {
    await sendMessage({ type: 'SET_ACTIVE_ACCOUNT', accountId: id });
    setActiveAccountId(id);
  }, []);

  const handleUpdateLabel = useCallback(async (id: string, label: string) => {
    await sendMessage({ type: 'UPDATE_ACCOUNT', account: { id, label } });
    await reloadAccounts();
  }, [reloadAccounts]);

  const handleAccountAdded = useCallback(async () => {
    await reloadAccounts();
    setShowAddForm(false);
  }, [reloadAccounts]);

  return (
    <div className="options-container">
      <header className="options-header">
        <h1>Arsenale Settings</h1>
        <p>Manage your Arsenale server accounts.</p>
      </header>

      <main className="options-main">
        <section className="options-section">
          <div className="options-section-header">
            <h2>Accounts</h2>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddForm(!showAddForm)}
            >
              {showAddForm ? 'Cancel' : 'Add Account'}
            </button>
          </div>

          {showAddForm && (
            <AddAccountForm
              onComplete={handleAccountAdded}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {loading ? (
            <p className="options-loading">Loading accounts...</p>
          ) : (
            <AccountList
              accounts={accounts}
              activeAccountId={activeAccountId}
              onSetActive={handleSetActive}
              onRemove={handleRemove}
              onUpdateLabel={handleUpdateLabel}
            />
          )}
        </section>

        <section className="options-section">
          <div className="options-section-header">
            <h2>Autofill</h2>
          </div>
          <AutofillSettings />
        </section>
      </main>
    </div>
  );
}
