import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, Box, IconButton, Typography,
  Chip, Tooltip, CircularProgress, Collapse, Table, TableBody, TableRow,
  TableCell, Alert,
} from '@mui/material';
import {
  Close as CloseIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon,
  OpenInNew as OpenInNewIcon,
  Analytics as AnalyticsIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import type { Recording } from '../../api/recordings.api';
import { analyzeRecording, type RecordingAnalysis } from '../../api/recordings.api';
import { openRecordingWindow } from '../../utils/openRecordingWindow';
import { extractApiError } from '../../utils/apiError';
import { getRecordingAuditTrail } from '../../api/audit.api';
import type { AuditLogEntry } from '../../api/audit.api';
import { ACTION_LABELS, getActionColor } from '../Audit/auditConstants';
import GuacPlayer from './GuacPlayer';
import SshPlayer from './SshPlayer';

interface RecordingPlayerDialogProps {
  open: boolean;
  onClose: () => void;
  recording: Recording | null;
}

const protocolColor = (protocol: string) => {
  switch (protocol) {
    case 'SSH': return 'success';
    case 'RDP': return 'primary';
    case 'VNC': return 'warning';
    default: return 'default';
  }
};

export default function RecordingPlayerDialog({
  open, onClose, recording,
}: RecordingPlayerDialogProps) {
  const [fullScreen, setFullScreen] = useState(false);
  const [analysis, setAnalysis] = useState<RecordingAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [auditTrail, setAuditTrail] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [showAuditTrail, setShowAuditTrail] = useState(false);

  if (!recording) return null;

  const isSsh = recording.format === 'asciicast';
  // SSH width/height are cols/rows, not pixels — convert with approximate char size
  const contentWidth = isSsh
    ? Math.max((recording.width || 80) * 14, 720)
    : (recording.width || 1024);
  const contentHeight = isSsh
    ? Math.max((recording.height || 24) * 9, 432)
    : (recording.height || 768);

  const handleAnalyze = async () => {
    if (!recording) return;
    if (analysis) { setShowAnalysis((v) => !v); return; }
    setAnalyzing(true);
    setAnalysisError('');
    try {
      const result = await analyzeRecording(recording.id);
      setAnalysis(result);
      setShowAnalysis(true);
    } catch (err: unknown) {
      setAnalysisError(extractApiError(err, 'Failed to analyze recording'));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleOpenInNewWindow = () => {
    openRecordingWindow(recording.id, recording.width, recording.height);
    onClose();
  };

  const handleAuditTrail = async () => {
    if (!recording) return;
    if (auditTrail.length > 0) { setShowAuditTrail((v) => !v); return; }
    setAuditLoading(true);
    try {
      const result = await getRecordingAuditTrail(recording.id);
      setAuditTrail(result.data);
      setShowAuditTrail(true);
    } catch {
      // Audit trail not available
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullScreen={fullScreen}
      slotProps={fullScreen ? undefined : {
        paper: {
          sx: {
            width: Math.min(contentWidth + 48, window.innerWidth - 64),
            height: Math.min(contentHeight + 140, window.innerHeight - 64),
            maxWidth: '100vw',
            maxHeight: '100vh',
            resize: 'both',
            overflow: 'hidden',
          },
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1, py: 1 }}>
        <Typography variant="subtitle1" component="span" sx={{ flex: 1 }} noWrap>
          {recording.connection.name}
        </Typography>
        <Chip
          label={recording.protocol}
          size="small"
          color={protocolColor(recording.protocol) as 'success' | 'primary' | 'warning' | 'default'}
        />
        {!isSsh && (
          <Tooltip title={analysis ? (showAnalysis ? 'Hide analysis' : 'Show analysis') : 'Analyze recording'}>
            <IconButton onClick={handleAnalyze} size="small" disabled={analyzing}>
              {analyzing ? <CircularProgress size={18} /> : <AnalyticsIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={auditTrail.length > 0 ? (showAuditTrail ? 'Hide audit trail' : 'Show audit trail') : 'Load audit trail'}>
          <IconButton onClick={handleAuditTrail} size="small" disabled={auditLoading}>
            {auditLoading ? <CircularProgress size={18} /> : <TimelineIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Open in new window">
          <IconButton onClick={handleOpenInNewWindow} size="small">
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={fullScreen ? 'Exit full screen' : 'Full screen'}>
          <IconButton onClick={() => setFullScreen((v) => !v)} size="small">
            {fullScreen ? <FullscreenExitIcon fontSize="small" /> : <FullscreenIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <IconButton onClick={onClose} size="small" edge="end">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {analysisError && <Alert severity="error" sx={{ m: 1 }}>{analysisError}</Alert>}
        <Collapse in={showAnalysis && !!analysis}>
          {analysis && (
            <Box sx={{ p: 2, bgcolor: 'action.hover', maxHeight: 200, overflow: 'auto' }}>
              <Typography variant="subtitle2" gutterBottom>Recording Analysis</Typography>
              <Table size="small">
                <TableBody>
                  <TableRow><TableCell>File Size</TableCell><TableCell>{(analysis.fileSize / 1024 / 1024).toFixed(2)} MB</TableCell></TableRow>
                  <TableRow><TableCell>Display</TableCell><TableCell>{analysis.displayWidth} x {analysis.displayHeight}</TableCell></TableRow>
                  <TableRow><TableCell>Sync Frames</TableCell><TableCell>{analysis.syncCount}</TableCell></TableRow>
                  <TableRow><TableCell>Has Display Data</TableCell><TableCell>{analysis.hasLayer0Image ? 'Yes' : 'No'}</TableCell></TableRow>
                  <TableRow><TableCell>Truncated</TableCell><TableCell>{analysis.truncated ? 'Yes (>10MB)' : 'No'}</TableCell></TableRow>
                  {Object.entries(analysis.instructions).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([op, count]) => (
                    <TableRow key={op}><TableCell sx={{ pl: 3 }}>{op}</TableCell><TableCell>{count.toLocaleString()}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Collapse>
        <Collapse in={showAuditTrail && auditTrail.length > 0}>
          <Box sx={{ p: 2, bgcolor: 'action.hover', maxHeight: 200, overflow: 'auto', borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" gutterBottom>Audit Trail</Typography>
            <Table size="small">
              <TableBody>
                {auditTrail.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap', width: 160 }}>
                      {new Date(entry.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={ACTION_LABELS[entry.action] || entry.action}
                        color={getActionColor(entry.action)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.details ? Object.entries(entry.details).map(([k, v]) => `${k}: ${v}`).join(' | ') : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Collapse>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
          }}
        >
          {isSsh ? (
            <SshPlayer recordingId={recording.id} />
          ) : (
            <GuacPlayer recordingId={recording.id} />
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
