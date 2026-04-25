import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { restoreSessionApi } from '@/api/auth.api';
import { useActivityTouch } from '@/hooks/useActivityTouch';
import {
  observeRdpSession,
  observeSshSession,
  observeVncSession,
  type ObserveDesktopSessionResponse,
  type ObserveSshSessionResponse,
} from '@/api/sessions.api';
import DesktopObserverViewer from '@/components/SessionObserver/DesktopObserverViewer';
import SshObserverTerminal from '@/components/Terminal/SshObserverTerminal';
import { useAuthStore } from '@/store/authStore';
import { extractApiError } from '@/utils/apiError';

type ObserverProtocolParam = 'ssh' | 'rdp' | 'vnc';

export default function SessionObserverPage() {
  const { id, protocol } = useParams<{ id: string; protocol: string }>();
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const applySession = useAuthStore((s) => s.applySession);

  const [authBootstrapped, setAuthBootstrapped] = useState(Boolean(accessToken));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sshSession, setSshSession] = useState<ObserveSshSessionResponse | null>(null);
  const [desktopSession, setDesktopSession] = useState<ObserveDesktopSessionResponse | null>(null);

  const normalizedProtocol = useMemo(() => {
    if (protocol === 'ssh' || protocol === 'rdp' || protocol === 'vnc') {
      return protocol as ObserverProtocolParam;
    }
    return null;
  }, [protocol]);

  const authReady = Boolean(accessToken) || authBootstrapped;
  const unsupportedProtocol = authReady && Boolean(protocol) && normalizedProtocol == null;

  useActivityTouch();

  useEffect(() => {
    if (accessToken || authBootstrapped) {
      return;
    }

    restoreSessionApi()
      .then((res) => {
        applySession(res.accessToken, res.csrfToken, res.user);
        setAuthBootstrapped(true);
      })
      .catch(() => {
        if (isAuthenticated) {
          setError('Authentication failed. Please log in again.');
        } else {
          setError('Not authenticated. Please log in.');
        }
        setLoading(false);
      });
  }, [accessToken, applySession, authBootstrapped, isAuthenticated]);

  useEffect(() => {
    if (!authReady || !id || !normalizedProtocol) {
      return;
    }

    const request = normalizedProtocol === 'ssh'
      ? observeSshSession(id)
      : normalizedProtocol === 'rdp'
        ? observeRdpSession(id)
        : observeVncSession(id);

    request
      .then((response) => {
        document.title = `Observe ${normalizedProtocol.toUpperCase()} Session - Arsenale`;
        if (normalizedProtocol === 'ssh') {
          setSshSession(response as ObserveSshSessionResponse);
        } else {
          setDesktopSession(response as ObserveDesktopSessionResponse);
        }
      })
      .catch((err) => {
        setError(extractApiError(err, 'Failed to start session observer'));
      })
      .finally(() => setLoading(false));
  }, [authReady, id, normalizedProtocol]);

  if (loading || !authReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || unsupportedProtocol || (!sshSession && !desktopSession)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-destructive">{error || (unsupportedProtocol ? 'Unsupported session protocol.' : 'Observer session not found')}</p>
      </div>
    );
  }

  const effectiveProtocol = normalizedProtocol?.toUpperCase() ?? desktopSession?.protocol ?? 'SSH';

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline">{effectiveProtocol}</Badge>
          <Badge className="border-primary/30 bg-primary/10 text-primary hover:bg-primary/10">
            Read-only observer
          </Badge>
          <span className="truncate text-sm text-muted-foreground">Session {id}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.close()}>
          Disconnect
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden bg-black">
        {sshSession ? (
          <SshObserverTerminal session={sshSession} />
        ) : desktopSession ? (
          <DesktopObserverViewer protocol={desktopSession.protocol} session={desktopSession} />
        ) : null}
      </div>
    </div>
  );
}
