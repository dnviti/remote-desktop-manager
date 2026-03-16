import React, { useState } from 'react';
import type { ExtensionConnection } from '../../lib/connectionsApi';

interface ConnectionItemProps {
  connection: ExtensionConnection;
  serverUrl: string;
  onToggleFavorite: (connectionId: string) => void;
}

/** SVG icon for connection type. */
function TypeIcon({ type }: { type: string }): React.ReactElement {
  if (type === 'SSH') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (type === 'VNC') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <circle cx="12" cy="10" r="3" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  }
  // RDP (default)
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

/** Star icon (filled or outline). */
function StarIcon({ filled }: { filled: boolean }): React.ReactElement {
  if (filled) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="#00e5a0" stroke="#00e5a0" strokeWidth="1.5">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
    </svg>
  );
}

export function ConnectionItem({
  connection,
  serverUrl,
  onToggleFavorite,
}: ConnectionItemProps): React.ReactElement {
  const [infoOpen, setInfoOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const hostPort = `${connection.host}:${String(connection.port)}`;

  const handleLaunch = () => {
    const url = `${serverUrl}/?autoconnect=${connection.id}`;
    chrome.tabs.create({ url });
  };

  const handleCopyHostPort = async () => {
    try {
      await navigator.clipboard.writeText(hostPort);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API may not be available in all extension contexts
    }
  };

  const handleToggleInfo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInfoOpen(!infoOpen);
  };

  return (
    <div className="conn-item">
      <div className="conn-item-row" onClick={handleLaunch} role="button" tabIndex={0}>
        <span className={`conn-type-icon conn-type-${connection.type.toLowerCase()}`}>
          <TypeIcon type={connection.type} />
        </span>
        <div className="conn-item-info">
          <span className="conn-item-name">{connection.name}</span>
          <span className="conn-item-host">{hostPort}</span>
        </div>
        <button
          className="btn btn-icon conn-fav-btn"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(connection.id); }}
          title={connection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={connection.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <StarIcon filled={connection.isFavorite} />
        </button>
        <button
          className="btn btn-icon conn-info-btn"
          onClick={handleToggleInfo}
          title="Connection details"
          aria-label="Connection details"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
      </div>

      {infoOpen && (
        <div className="conn-info-panel">
          <div className="conn-info-row">
            <span className="conn-info-label">Host</span>
            <span className="conn-info-value">
              {hostPort}
              <button
                className="btn btn-ghost btn-xs conn-copy-btn"
                onClick={handleCopyHostPort}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </span>
          </div>
          <div className="conn-info-row">
            <span className="conn-info-label">Type</span>
            <span className="conn-info-value">{connection.type}</span>
          </div>
          {connection.description && (
            <div className="conn-info-row">
              <span className="conn-info-label">Description</span>
              <span className="conn-info-value">{connection.description}</span>
            </div>
          )}
          {connection.credentialSecretName && (
            <div className="conn-info-row">
              <span className="conn-info-label">Credential</span>
              <span className="conn-info-value">{connection.credentialSecretName}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
