import React from 'react';
import type { Account } from '../types';

interface VaultStatusProps {
  account: Account;
}

export function VaultStatus({ account }: VaultStatusProps): React.ReactElement {
  return (
    <div className={`vault-status ${account.vaultUnlocked ? 'unlocked' : 'locked'}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {account.vaultUnlocked ? (
          <>
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 019.9-1" />
          </>
        ) : (
          <>
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </>
        )}
      </svg>
      <span>Vault {account.vaultUnlocked ? 'Unlocked' : 'Locked'}</span>
      <span className="vault-server">{account.serverUrl}</span>
    </div>
  );
}
