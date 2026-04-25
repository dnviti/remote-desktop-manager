import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { restoreSessionApi } from '../api/auth.api';
import { getRecording } from '../api/recordings.api';
import type { Recording } from '../api/recordings.api';
import { useActivityTouch } from '../hooks/useActivityTouch';
import { useAuthStore } from '../store/authStore';
import GuacPlayer from '../components/Recording/GuacPlayer';
import SshPlayer from '../components/Recording/SshPlayer';
import { extractApiError } from '../utils/apiError';

export default function RecordingPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const applySession = useAuthStore((s) => s.applySession);

  const [authReady, setAuthReady] = useState(Boolean(accessToken));
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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

  // Fetch recording data once auth is ready
  useEffect(() => {
    if (!authReady || !id) return;
    getRecording(id)
      .then((data) => {
        setRecording(data);
        document.title = `${data.connection.name} (${data.protocol}) - Recording - Arsenale`;
      })
      .catch((err) => {
        setError(extractApiError(err, 'Failed to load recording'));
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

  if (error || !recording) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#1a1a2e]">
        <p className="text-sm text-destructive">{error || 'Recording not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#1a1a2e]">
      {recording.format === 'asciicast' ? (
        <SshPlayer recordingId={recording.id} />
      ) : (
        <GuacPlayer recordingId={recording.id} />
      )}
    </div>
  );
}
