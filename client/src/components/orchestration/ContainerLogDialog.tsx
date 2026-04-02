import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, Box, IconButton, Typography,
  CircularProgress, Select, MenuItem, Tooltip, SelectChangeEvent,
  ToggleButton,
} from '@mui/material';
import {
  Close as CloseIcon,
  Refresh as RefreshIcon,
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
} from '@mui/icons-material';
import type { ContainerLogStreamSnapshot } from '../../api/live.api';
import { connectSSE } from '../../api/sse';
import { getInstanceLogs, type ManagedInstanceData } from '../../api/gateway.api';
import { useAuthStore } from '../../store/authStore';

const TAIL_OPTIONS = [100, 200, 500, 1000] as const;
const MIN_HEIGHT = 200;
const DEFAULT_HEIGHT = 500;

interface ContainerLogDialogProps {
  open: boolean;
  onClose: () => void;
  gatewayId: string;
  instance: ManagedInstanceData | null;
}

export default function ContainerLogDialog({
  open, onClose, gatewayId, instance,
}: ContainerLogDialogProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tail, setTail] = useState<number>(200);
  const [live, setLive] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!instance) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getInstanceLogs(gatewayId, instance.id, tail);
      setLogs(data.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, [gatewayId, instance, tail]);

  // Initial fetch on open / tail change
  useEffect(() => {
    if (!open) {
      setLogs('');
      setError(null);
      setLive(true);
      setLoading(false);
      return;
    }
    if (open && instance && !live) {
      void fetchLogs();
    }
  }, [open, instance, live, fetchLogs]);

  useEffect(() => {
    if (!live || !open || !instance || !accessToken) return undefined;

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ tail: String(tail) });
    return connectSSE({
      url: `/api/gateways/${gatewayId}/instances/${instance.id}/logs/stream?${params.toString()}`,
      accessToken,
      onEvent: ({ event, data }) => {
        if (event !== 'snapshot') return;
        const snapshot = data as ContainerLogStreamSnapshot;
        setLogs(snapshot.logs);
        setLoading(false);
        setError(null);
      },
      onError: (streamError) => {
        const status = (streamError as Error & { status?: number }).status;
        setError(streamError.message);
        setLoading(false);
        if (status != null && !(status === 408 || status === 429 || (status >= 500 && status !== 501))) {
          setLive(false);
        }
      },
    });
  }, [live, open, instance, accessToken, tail, gatewayId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (logs && logsEndRef.current) {
      logsEndRef.current.scrollIntoView();
    }
  }, [logs]);

  const handleTailChange = (e: SelectChangeEvent<number>) => {
    setTail(Number(e.target.value));
  };

  // Resize drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientY - dragRef.current.startY;
      setHeight(Math.max(MIN_HEIGHT, dragRef.current.startH + delta));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height]);

  const handleClose = () => {
    setLive(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      fullScreen={fullScreen}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Typography variant="h6" component="span" sx={{ flex: 1, fontFamily: 'monospace' }} noWrap>
          {instance?.containerName ?? 'Container Logs'}
        </Typography>
        <Select
          size="small"
          value={tail}
          onChange={handleTailChange}
          sx={{ minWidth: 100 }}
        >
          {TAIL_OPTIONS.map((n) => (
            <MenuItem key={n} value={n}>{n} lines</MenuItem>
          ))}
        </Select>
        <Tooltip title={live ? 'Pause live' : 'Live view (auto-refresh)'}>
          <ToggleButton
            value="live"
            selected={live}
            onChange={() => setLive((v) => !v)}
            size="small"
            sx={{ border: 0, minWidth: 0, px: 0.75 }}
          >
            {live ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
          </ToggleButton>
        </Tooltip>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={fetchLogs} disabled={loading} size="small">
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={fullScreen ? 'Exit full screen' : 'Full screen'}>
          <IconButton onClick={() => setFullScreen((v) => !v)} size="small">
            {fullScreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
        </Tooltip>
        <IconButton onClick={handleClose} size="small" edge="end">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        {loading && !logs ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Box sx={{ p: 2 }}>
            <Typography color="error">{error}</Typography>
          </Box>
        ) : !logs ? (
          <Box sx={{ p: 2 }}>
            <Typography color="text.secondary">No logs available</Typography>
          </Box>
        ) : (
          <Box
            sx={{
              bgcolor: 'grey.900',
              color: 'grey.100',
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              lineHeight: 1.6,
              whiteSpace: 'pre',
              overflowX: 'auto',
              p: 2,
              height: fullScreen ? '100%' : height,
              overflowY: 'auto',
              flex: fullScreen ? 1 : undefined,
            }}
          >
            {logs}
            <div ref={logsEndRef} />
          </Box>
        )}
        {/* Resize drag handle — hidden in full screen */}
        {!fullScreen && logs && (
          <Box
            onMouseDown={handleDragStart}
            sx={{
              height: 6,
              cursor: 'ns-resize',
              bgcolor: 'divider',
              '&:hover': { bgcolor: 'primary.main' },
              flexShrink: 0,
            }}
          />
        )}
      </DialogContent>
      {live && (
        <Box sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            sx={{
              width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main',
              animation: 'pulse 1.5s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.4 },
              },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Live stream connected
          </Typography>
        </Box>
      )}
    </Dialog>
  );
}
