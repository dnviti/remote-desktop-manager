import React, { useState, useRef, useEffect } from 'react';
import type { Account } from '../types';

interface AccountSwitcherProps {
  accounts: Account[];
  activeAccountId: string | null;
  onSwitch: (id: string) => void;
}

export function AccountSwitcher({
  accounts,
  activeAccountId,
  onSwitch,
}: AccountSwitcherProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="account-switcher" ref={dropdownRef}>
      <button
        className="account-switcher-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="account-avatar">
          {(activeAccount?.label ?? '?')[0].toUpperCase()}
        </span>
        <span className="account-label">
          {activeAccount?.label ?? 'Select account'}
        </span>
        <svg
          className={`account-chevron ${open ? 'open' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul className="account-dropdown" role="listbox">
          {accounts.map((account) => (
            <li
              key={account.id}
              role="option"
              aria-selected={account.id === activeAccountId}
              className={`account-option ${account.id === activeAccountId ? 'selected' : ''}`}
              onClick={() => {
                onSwitch(account.id);
                setOpen(false);
              }}
            >
              <span className="account-avatar small">
                {account.label[0].toUpperCase()}
              </span>
              <div className="account-option-info">
                <span className="account-option-label">{account.label}</span>
                <span className="account-option-email">{account.email}</span>
              </div>
              {account.vaultUnlocked && (
                <span className="vault-badge unlocked" title="Vault unlocked">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V7a5 5 0 019.9-1" />
                  </svg>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
