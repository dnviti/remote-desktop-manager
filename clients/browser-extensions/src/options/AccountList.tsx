import React, { useState } from 'react';
import type { Account } from '../types';

interface AccountListProps {
  accounts: Account[];
  activeAccountId: string | null;
  onSetActive: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdateLabel: (id: string, label: string) => void;
}

export function AccountList({
  accounts,
  activeAccountId,
  onSetActive,
  onRemove,
  onUpdateLabel,
}: AccountListProps): React.ReactElement {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  if (accounts.length === 0) {
    return (
      <div className="account-list-empty">
        <p>No accounts configured yet. Click &quot;Add Account&quot; to get started.</p>
      </div>
    );
  }

  const handleStartEdit = (account: Account) => {
    setEditingId(account.id);
    setEditLabel(account.label);
  };

  const handleSaveEdit = (id: string) => {
    if (editLabel.trim()) {
      onUpdateLabel(id, editLabel.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
  };

  return (
    <ul className="account-list">
      {accounts.map((account) => (
        <li
          key={account.id}
          className={`account-list-item ${account.id === activeAccountId ? 'active' : ''}`}
        >
          <div className="account-list-avatar">
            {account.label[0].toUpperCase()}
          </div>
          <div className="account-list-info">
            {editingId === account.id ? (
              <div className="account-edit-row">
                <input
                  type="text"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="input input-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit(account.id);
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
                <button className="btn btn-ghost btn-xs" onClick={() => handleSaveEdit(account.id)}>Save</button>
                <button className="btn btn-ghost btn-xs" onClick={handleCancelEdit}>Cancel</button>
              </div>
            ) : (
              <>
                <span className="account-list-label">{account.label}</span>
                <span className="account-list-email">{account.email}</span>
                <span className="account-list-url">{account.serverUrl}</span>
              </>
            )}
          </div>
          <div className="account-list-actions">
            {account.id === activeAccountId ? (
              <span className="badge badge-active">Default</span>
            ) : (
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => onSetActive(account.id)}
              >
                Set Default
              </button>
            )}
            {editingId !== account.id && (
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => handleStartEdit(account)}
              >
                Edit
              </button>
            )}
            {confirmRemoveId === account.id ? (
              <div className="confirm-remove">
                <span className="confirm-text">Remove?</span>
                <button className="btn btn-danger btn-xs" onClick={() => { onRemove(account.id); setConfirmRemoveId(null); }}>
                  Yes
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => setConfirmRemoveId(null)}>
                  No
                </button>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-xs btn-danger-text"
                onClick={() => setConfirmRemoveId(account.id)}
              >
                Remove
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
