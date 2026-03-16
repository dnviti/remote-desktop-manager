import React, { useState } from 'react';
import { sendMessage } from '../../lib/apiClient';
import type { TenantMembership } from '../../types';

interface TenantPickerPageProps {
  accountId: string;
  memberships: TenantMembership[];
  onSelect: () => void;
  onSkip: () => void;
}

export function TenantPickerPage({
  accountId,
  memberships,
  onSelect,
  onSkip,
}: TenantPickerPageProps): React.ReactElement {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = async (tenantId: string) => {
    setLoading(true);
    setError(null);
    setSelectedId(tenantId);

    const result = await sendMessage({
      type: 'SWITCH_TENANT',
      accountId,
      tenantId,
    });

    setLoading(false);

    if (result.success) {
      onSelect();
    } else {
      setError(result.error ?? 'Failed to switch tenant');
      setSelectedId(null);
    }
  };

  const activeMembership = memberships.find((m) => m.isActive);

  return (
    <div className="tenant-picker">
      <div className="login-header">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87" />
          <path d="M16 3.13a4 4 0 010 7.75" />
        </svg>
        <h2>Select Organization</h2>
        <p>Choose which organization to use.</p>
      </div>

      <ul className="tenant-list">
        {memberships.map((m) => (
          <li key={m.tenantId} className="tenant-list-item">
            <button
              className={`tenant-option ${m.isActive ? 'active' : ''} ${selectedId === m.tenantId ? 'selected' : ''}`}
              onClick={() => handleSelect(m.tenantId)}
              disabled={loading}
            >
              <span className="tenant-avatar">
                {m.name[0].toUpperCase()}
              </span>
              <div className="tenant-info">
                <span className="tenant-name">{m.name}</span>
                <span className="tenant-role">{m.role}</span>
              </div>
              {m.isActive && (
                <span className="badge badge-active">Current</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {error && <p className="form-error" style={{ padding: '0 16px' }}>{error}</p>}

      {activeMembership && (
        <button
          className="btn btn-ghost btn-full tenant-skip"
          onClick={onSkip}
          disabled={loading}
        >
          Keep current: {activeMembership.name}
        </button>
      )}
    </div>
  );
}
