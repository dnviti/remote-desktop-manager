import React, { useEffect, useState, useCallback } from 'react';
import { sendMessage } from '../lib/apiClient';

/**
 * Autofill preferences component for the extension options page.
 *
 * Allows the user to:
 * - Enable/disable autofill globally
 * - Manage a list of sites where autofill is disabled
 */
export function AutofillSettings(): React.ReactElement {
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [disabledSites, setDisabledSites] = useState<string[]>([]);
  const [newSite, setNewSite] = useState('');
  const [loading, setLoading] = useState(true);

  // Load preferences on mount
  useEffect(() => {
    let mounted = true;
    Promise.all([
      sendMessage<{ enabled: boolean }>({ type: 'AUTOFILL_GET_GLOBAL_ENABLED' }),
      sendMessage<{ sites: string[] }>({ type: 'AUTOFILL_GET_DISABLED_SITES' }),
    ]).then(([enabledRes, sitesRes]) => {
      if (!mounted) return;
      if (enabledRes.success && enabledRes.data) {
        setGlobalEnabled(enabledRes.data.enabled);
      }
      if (sitesRes.success && sitesRes.data) {
        setDisabledSites(sitesRes.data.sites);
      }
      setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  const handleToggleGlobal = useCallback(async () => {
    const newValue = !globalEnabled;
    setGlobalEnabled(newValue);
    await sendMessage({ type: 'AUTOFILL_SET_GLOBAL_ENABLED', enabled: newValue });
  }, [globalEnabled]);

  const handleAddSite = useCallback(async () => {
    const site = newSite.trim().toLowerCase();
    if (!site || disabledSites.includes(site)) {
      setNewSite('');
      return;
    }
    const updated = [...disabledSites, site];
    setDisabledSites(updated);
    setNewSite('');
    await sendMessage({ type: 'AUTOFILL_SET_DISABLED_SITES', sites: updated });
  }, [newSite, disabledSites]);

  const handleRemoveSite = useCallback(async (site: string) => {
    const updated = disabledSites.filter((s) => s !== site);
    setDisabledSites(updated);
    await sendMessage({ type: 'AUTOFILL_SET_DISABLED_SITES', sites: updated });
  }, [disabledSites]);

  if (loading) {
    return <p className="options-loading">Loading autofill settings...</p>;
  }

  return (
    <div className="autofill-settings">
      <div className="autofill-toggle-row">
        <label className="autofill-toggle-label" htmlFor="autofill-global-toggle">
          <span className="autofill-toggle-text">Enable credential autofill</span>
          <span className="autofill-toggle-hint">
            Automatically detect login forms and offer to fill credentials from your keychain.
          </span>
        </label>
        <button
          id="autofill-global-toggle"
          className={`autofill-toggle-btn ${globalEnabled ? 'active' : ''}`}
          onClick={handleToggleGlobal}
          role="switch"
          aria-checked={globalEnabled}
        >
          <span className="autofill-toggle-knob" />
        </button>
      </div>

      {globalEnabled && (
        <div className="autofill-disabled-sites">
          <h3 className="autofill-sites-title">Disabled sites</h3>
          <p className="autofill-sites-hint">
            Autofill will not run on these domains.
          </p>

          <div className="autofill-add-site-row">
            <input
              type="text"
              className="input"
              placeholder="example.com"
              value={newSite}
              onChange={(e) => setNewSite(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSite();
              }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAddSite}
              disabled={!newSite.trim()}
            >
              Add
            </button>
          </div>

          {disabledSites.length > 0 ? (
            <ul className="autofill-site-list">
              {disabledSites.map((site) => (
                <li key={site} className="autofill-site-item">
                  <span className="autofill-site-domain">{site}</span>
                  <button
                    className="btn btn-ghost btn-xs btn-danger-text"
                    onClick={() => handleRemoveSite(site)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="autofill-sites-empty">No sites disabled.</p>
          )}
        </div>
      )}
    </div>
  );
}
