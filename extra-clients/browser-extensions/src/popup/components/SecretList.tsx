import React, { useEffect, useState, useCallback, useRef } from 'react';
import type {
  SecretListItem,
  SecretType,
  SecretListFilters,
  VaultFolderData,
} from '../../types';
import { listSecrets } from '../../lib/secretsApi';
import { listVaultFolders } from '../../lib/vaultApi';

interface SecretListProps {
  accountId: string;
  onSelect: (secret: SecretListItem) => void;
  /** Called when the vault turns out to be locked (API returns 403). */
  onVaultLocked: () => void;
}

/** Map secret type to a compact SVG icon. */
function SecretTypeIcon({ type }: { type: SecretType }): React.ReactElement {
  const size = 16;
  const strokeWidth = 1.5;

  switch (type) {
    case 'LOGIN':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
          <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
      );
    case 'SSH_KEY':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
        </svg>
      );
    case 'CERTIFICATE':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
          <path d="M12 15l-2 5 2-1 2 1-2-5z" />
          <circle cx="12" cy="9" r="6" />
        </svg>
      );
    case 'API_KEY':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
          <rect x="2" y="7" width="20" height="10" rx="2" />
          <path d="M12 7v10M7 7v10M17 7v10" />
        </svg>
      );
    case 'SECURE_NOTE':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
      );
  }
}

const TYPE_LABELS: Record<SecretType, string> = {
  LOGIN: 'Login',
  SSH_KEY: 'SSH Key',
  CERTIFICATE: 'Certificate',
  API_KEY: 'API Key',
  SECURE_NOTE: 'Note',
};

const ALL_TYPES: SecretType[] = ['LOGIN', 'SSH_KEY', 'CERTIFICATE', 'API_KEY', 'SECURE_NOTE'];

export function SecretList({
  accountId,
  onSelect,
  onVaultLocked,
}: SecretListProps): React.ReactElement {
  const [secrets, setSecrets] = useState<SecretListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<SecretType | ''>('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [folders, setFolders] = useState<VaultFolderData[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | ''>('');
  const mountedRef = useRef(true);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load folders on mount
  useEffect(() => {
    mountedRef.current = true;
    void loadFolders();
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const loadFolders = useCallback(async () => {
    const res = await listVaultFolders(accountId);
    if (!mountedRef.current) return;
    if (res.success && res.data) {
      const all = [
        ...res.data.personal,
        ...res.data.team,
        ...res.data.tenant,
      ];
      setFolders(all);
    }
  }, [accountId]);

  // Load secrets whenever filters change (debounce search)
  const loadSecrets = useCallback(async (
    searchVal: string,
    typeVal: SecretType | '',
    favVal: boolean,
    folderVal: string | '',
  ) => {
    setLoading(true);
    setError(null);

    const filters: SecretListFilters = {};
    if (searchVal.trim()) filters.search = searchVal.trim();
    if (typeVal) filters.type = typeVal;
    if (favVal) filters.isFavorite = true;
    if (folderVal) filters.folderId = folderVal;

    const res = await listSecrets(accountId, filters);
    if (!mountedRef.current) return;

    if (res.success && res.data) {
      setSecrets(res.data);
      setLoading(false);
    } else {
      // Detect vault locked (server returns 403 when vault is locked)
      if (res.error?.includes('403') || res.error?.toLowerCase().includes('vault')) {
        onVaultLocked();
        return;
      }
      setError(res.error ?? 'Failed to load secrets');
      setLoading(false);
    }
  }, [accountId, onVaultLocked]);

  // Initial load + reload on filter changes (except search, which is debounced)
  useEffect(() => {
    void loadSecrets(search, typeFilter, favoritesOnly, selectedFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, favoritesOnly, selectedFolderId, accountId]);

  // Debounced search
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      void loadSecrets(val, typeFilter, favoritesOnly, selectedFolderId);
    }, 300);
  };

  return (
    <div className="secret-list-container">
      {/* Search bar */}
      <div className="secret-search">
        <svg className="secret-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="input secret-search-input"
          placeholder="Search secrets..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {/* Filter bar */}
      <div className="secret-filters">
        <select
          className="secret-filter-select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as SecretType | '')}
        >
          <option value="">All types</option>
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>

        {folders.length > 0 && (
          <select
            className="secret-filter-select"
            value={selectedFolderId}
            onChange={(e) => setSelectedFolderId(e.target.value)}
          >
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        )}

        <button
          className={`btn btn-icon secret-fav-toggle ${favoritesOnly ? 'active' : ''}`}
          onClick={() => setFavoritesOnly(!favoritesOnly)}
          title={favoritesOnly ? 'Show all' : 'Favorites only'}
          aria-label={favoritesOnly ? 'Show all' : 'Favorites only'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={favoritesOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      </div>

      {/* List */}
      {loading && (
        <div className="secret-list-loading">Loading secrets...</div>
      )}

      {error && (
        <div className="secret-list-error">
          <p className="form-error">{error}</p>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => loadSecrets(search, typeFilter, favoritesOnly, selectedFolderId)}
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && secrets.length === 0 && (
        <div className="secret-list-empty">
          <p>No secrets found.</p>
        </div>
      )}

      {!loading && !error && secrets.length > 0 && (
        <ul className="secret-list">
          {secrets.map((secret) => (
            <li key={secret.id} className="secret-list-item">
              <button
                className="secret-list-row"
                onClick={() => onSelect(secret)}
              >
                <span className="secret-type-icon">
                  <SecretTypeIcon type={secret.type} />
                </span>
                <div className="secret-list-info">
                  <span className="secret-list-name">{secret.name}</span>
                  <span className="secret-list-meta">
                    {TYPE_LABELS[secret.type]}
                    {secret.description ? ` \u2014 ${secret.description}` : ''}
                  </span>
                </div>
                {secret.isFavorite && (
                  <span className="secret-fav-star" title="Favorite">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
