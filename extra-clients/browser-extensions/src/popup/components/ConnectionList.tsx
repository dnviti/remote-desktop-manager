import React, { useState, useMemo } from 'react';
import type { ExtensionConnection } from '../../lib/connectionsApi';
import { ConnectionItem } from './ConnectionItem';

interface ConnectionListProps {
  own: ExtensionConnection[];
  shared: ExtensionConnection[];
  team: ExtensionConnection[];
  serverUrl: string;
  onToggleFavorite: (connectionId: string) => void;
}

type ScopeGroup = 'favorites' | 'my' | 'shared' | 'team';

function filterConnections(
  connections: ExtensionConnection[],
  query: string,
): ExtensionConnection[] {
  if (!query) return connections;
  const lower = query.toLowerCase();
  return connections.filter(
    (c) =>
      c.name.toLowerCase().includes(lower) ||
      c.host.toLowerCase().includes(lower) ||
      c.type.toLowerCase().includes(lower),
  );
}

/** Section header with connection count. */
function SectionHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button className="conn-section-header" onClick={onToggle} aria-expanded={!collapsed}>
      <svg
        className={`conn-section-chevron ${collapsed ? '' : 'open'}`}
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
      <span className="conn-section-label">{label}</span>
      <span className="conn-section-count">{String(count)}</span>
    </button>
  );
}

export function ConnectionList({
  own,
  shared,
  team,
  serverUrl,
  onToggleFavorite,
}: ConnectionListProps): React.ReactElement {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<ScopeGroup, boolean>>({
    favorites: false,
    my: false,
    shared: false,
    team: false,
  });

  const toggleSection = (key: ScopeGroup) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const allConnections = useMemo(
    () => [...own, ...shared, ...team],
    [own, shared, team],
  );

  const filteredOwn = useMemo(() => filterConnections(own, search), [own, search]);
  const filteredShared = useMemo(() => filterConnections(shared, search), [shared, search]);
  const filteredTeam = useMemo(() => filterConnections(team, search), [team, search]);

  const favorites = useMemo(
    () => filterConnections(allConnections.filter((c) => c.isFavorite), search),
    [allConnections, search],
  );

  const totalFiltered = filteredOwn.length + filteredShared.length + filteredTeam.length;

  return (
    <div className="conn-list">
      <div className="conn-search-bar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="conn-search-input"
          placeholder="Search connections..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="btn btn-icon conn-search-clear"
            onClick={() => setSearch('')}
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {totalFiltered === 0 && (
        <div className="conn-empty">
          {search ? 'No connections match your search.' : 'No connections found.'}
        </div>
      )}

      {favorites.length > 0 && (
        <div className="conn-section">
          <SectionHeader
            label="Favorites"
            count={favorites.length}
            collapsed={collapsed.favorites}
            onToggle={() => toggleSection('favorites')}
          />
          {!collapsed.favorites &&
            favorites.map((c) => (
              <ConnectionItem
                key={`fav-${c.id}`}
                connection={c}
                serverUrl={serverUrl}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
        </div>
      )}

      {filteredOwn.length > 0 && (
        <div className="conn-section">
          <SectionHeader
            label="My Connections"
            count={filteredOwn.length}
            collapsed={collapsed.my}
            onToggle={() => toggleSection('my')}
          />
          {!collapsed.my &&
            filteredOwn.map((c) => (
              <ConnectionItem
                key={`own-${c.id}`}
                connection={c}
                serverUrl={serverUrl}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
        </div>
      )}

      {filteredShared.length > 0 && (
        <div className="conn-section">
          <SectionHeader
            label="Shared"
            count={filteredShared.length}
            collapsed={collapsed.shared}
            onToggle={() => toggleSection('shared')}
          />
          {!collapsed.shared &&
            filteredShared.map((c) => (
              <ConnectionItem
                key={`shared-${c.id}`}
                connection={c}
                serverUrl={serverUrl}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
        </div>
      )}

      {filteredTeam.length > 0 && (
        <div className="conn-section">
          <SectionHeader
            label="Team"
            count={filteredTeam.length}
            collapsed={collapsed.team}
            onToggle={() => toggleSection('team')}
          />
          {!collapsed.team &&
            filteredTeam.map((c) => (
              <ConnectionItem
                key={`team-${c.id}`}
                connection={c}
                serverUrl={serverUrl}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
        </div>
      )}
    </div>
  );
}
