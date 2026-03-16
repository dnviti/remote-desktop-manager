import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Account } from '../../types';
import type { ExtensionConnection, ConnectionsResponse } from '../../lib/connectionsApi';
import { listConnections, toggleFavorite } from '../../lib/connectionsApi';
import { ConnectionList } from '../components/ConnectionList';
import type { BackgroundResponse } from '../../types';

interface ConnectionsPageProps {
  account: Account;
}

/** Fetch connections via the service worker. Module-level to avoid lint issues. */
async function fetchConnectionData(
  accountId: string,
): Promise<BackgroundResponse<ConnectionsResponse>> {
  return listConnections(accountId);
}

export function ConnectionsPage({ account }: ConnectionsPageProps): React.ReactElement {
  const [own, setOwn] = useState<ExtensionConnection[]>([]);
  const [shared, setShared] = useState<ExtensionConnection[]>([]);
  const [team, setTeam] = useState<ExtensionConnection[]>([]);
  // Loading starts true so the initial fetch doesn't flash content
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetchConnectionData(account.id).then((result) => {
      if (!mountedRef.current) return;
      if (result.success && result.data) {
        setOwn(result.data.own);
        setShared(result.data.shared);
        setTeam(result.data.team);
        setError(null);
      } else {
        setError(result.error ?? 'Failed to load connections');
      }
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current) return;
      setError('Failed to load connections');
      setLoading(false);
    });
    return () => { mountedRef.current = false; };
  }, [account.id]);

  const handleRetry = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchConnectionData(account.id).then((result) => {
      if (!mountedRef.current) return;
      if (result.success && result.data) {
        setOwn(result.data.own);
        setShared(result.data.shared);
        setTeam(result.data.team);
        setError(null);
      } else {
        setError(result.error ?? 'Failed to load connections');
      }
      setLoading(false);
    }).catch(() => {
      if (!mountedRef.current) return;
      setError('Failed to load connections');
      setLoading(false);
    });
  }, [account.id]);

  const handleToggleFavorite = useCallback(
    async (connectionId: string) => {
      // Optimistic update across all lists
      const updater = (connections: ExtensionConnection[]) =>
        connections.map((c) =>
          c.id === connectionId ? { ...c, isFavorite: !c.isFavorite } : c,
        );
      setOwn(updater);
      setShared(updater);
      setTeam(updater);

      const result = await toggleFavorite(account.id, connectionId);
      if (!mountedRef.current) return;

      if (result.success && result.data) {
        const serverData = result.data;
        const applyServer = (connections: ExtensionConnection[]) =>
          connections.map((c) =>
            c.id === serverData.id
              ? { ...c, isFavorite: serverData.isFavorite }
              : c,
          );
        setOwn(applyServer);
        setShared(applyServer);
        setTeam(applyServer);
      }
    },
    [account.id],
  );

  if (loading) {
    return (
      <div className="tab-panel">
        <div className="conn-loading">Loading connections...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tab-panel">
        <div className="conn-error">
          <p>{error}</p>
          <button className="btn btn-ghost" onClick={handleRetry}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (own.length === 0 && shared.length === 0 && team.length === 0) {
    return (
      <div className="tab-panel">
        <div className="tab-placeholder-section">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
          <h3>No Connections</h3>
          <p>
            Create connections in the Arsenale web UI to see them here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-panel tab-panel-flush">
      <ConnectionList
        own={own}
        shared={shared}
        team={team}
        serverUrl={account.serverUrl}
        onToggleFavorite={handleToggleFavorite}
      />
    </div>
  );
}
