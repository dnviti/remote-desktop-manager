import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getConnection, ConnectionData } from '../api/connections.api';
import { restoreSessionApi } from '../api/auth.api';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { useAuthStore } from '../store/authStore';
import SshTerminal from '../components/Terminal/SshTerminal';
import RdpViewer from '../components/RDP/RdpViewer';
import VncViewer from '../components/VNC/VncViewer';
import { extractApiError } from '../utils/apiError';
import { resolveConnectionViewerTabId } from '../utils/tabInstance';

export default function ConnectionViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const applySession = useAuthStore((s) => s.applySession);

  const [authReady, setAuthReady] = useState(Boolean(accessToken));
  const [connection, setConnection] = useState<ConnectionData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const popupSearch = searchParams.toString();
  const popupTabId = useMemo(
    () => resolveConnectionViewerTabId(popupSearch, id ?? 'connection'),
    [id, popupSearch],
  );

  useActivityTouch();

  // Bootstrap auth: accessToken is not persisted, so refresh it for popup windows
  /* eslint-disable react-hooks/set-state-in-effect -- bootstrap auth state for popup windows */
  useEffect(() => {
    if (accessToken) {
      setAuthReady(true);
      return;
    }
    restoreSessionApi()
      .then((res) => {
        applySession(res.accessToken, res.csrfToken, res.user);
        setAuthReady(true);
      })
      .catch(() => {
        if (isAuthenticated) {
          setError('Authentication failed. Please log in again.');
        } else {
          setError('Not authenticated. Please log in.');
        }
        setLoading(false);
      });
  }, [accessToken, applySession, isAuthenticated]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Fetch connection data once auth is ready
  useEffect(() => {
    if (!authReady || !id) return;
    getConnection(id)
      .then((data) => {
        setConnection(data);
        document.title = `${data.name} - Arsenale`;
      })
      .catch((err) => {
        setError(extractApiError(err, 'Failed to load connection'));
      })
      .finally(() => setLoading(false));
  }, [authReady, id]);

  if (loading || !authReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#1a1a2e]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !connection) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#1a1a2e]">
        <p className="text-sm text-destructive">{error || 'Connection not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#1a1a2e]">
      {connection.type === 'SSH' ? (
        <SshTerminal connectionId={connection.id} tabId={popupTabId} />
      ) : connection.type === 'VNC' ? (
        <VncViewer connectionId={connection.id} tabId={popupTabId} />
      ) : (
        <RdpViewer connectionId={connection.id} tabId={popupTabId} />
      )}
    </div>
  );
}
