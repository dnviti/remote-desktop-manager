import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Switch, FormControlLabel, Button, Chip,
  CircularProgress, Alert, TextField, Accordion, AccordionSummary,
  AccordionDetails, Table, TableBody, TableCell, TableHead, TableRow,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Autorenew as RotateIcon,
  CheckCircle as SuccessIcon,
  Error as ErrorIcon,
  HourglassEmpty as PendingIcon,
} from '@mui/icons-material';
import {
  getRotationStatus, enableRotation, disableRotation,
  triggerRotation, getRotationHistory,
} from '../../api/secrets.api';
import type { RotationStatusResult, RotationHistoryEntry } from '../../api/secrets.api';
import { extractApiError } from '../../utils/apiError';

interface PasswordRotationPanelProps {
  secretId: string;
  isReadOnly?: boolean;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  SUCCESS: <SuccessIcon fontSize="small" color="success" />,
  FAILED: <ErrorIcon fontSize="small" color="error" />,
  PENDING: <PendingIcon fontSize="small" color="warning" />,
};

export default function PasswordRotationPanel({ secretId, isReadOnly }: PasswordRotationPanelProps) {
  const [status, setStatus] = useState<RotationStatusResult | null>(null);
  const [history, setHistory] = useState<RotationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [intervalDays, setIntervalDays] = useState(30);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [s, h] = await Promise.all([
        getRotationStatus(secretId),
        getRotationHistory(secretId, 10),
      ]);
      setStatus(s);
      setHistory(h);
      setIntervalDays(s.intervalDays);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load rotation status'));
    } finally {
      setLoading(false);
    }
  }, [secretId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (enabled: boolean) => {
    setToggling(true);
    setError(null);
    setSuccessMsg(null);
    try {
      if (enabled) {
        await enableRotation(secretId, intervalDays);
        setSuccessMsg('Password rotation enabled');
      } else {
        await disableRotation(secretId);
        setSuccessMsg('Password rotation disabled');
      }
      await fetchData();
    } catch (err) {
      setError(extractApiError(err, 'Failed to update rotation settings'));
    } finally {
      setToggling(false);
    }
  };

  const handleTrigger = async () => {
    setRotating(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await triggerRotation(secretId);
      if (result.success) {
        setSuccessMsg('Password rotated successfully');
      } else {
        setError(`Rotation failed: ${result.error || 'Unknown error'}`);
      }
      await fetchData();
    } catch (err) {
      setError(extractApiError(err, 'Failed to trigger rotation'));
    } finally {
      setRotating(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <FormControlLabel
          control={
            <Switch
              checked={status?.enabled ?? false}
              onChange={(_, checked) => handleToggle(checked)}
              disabled={isReadOnly || toggling}
              size="small"
            />
          }
          label={
            <Typography variant="body2">
              Auto-rotate password
            </Typography>
          }
        />
        {status?.enabled && !isReadOnly && (
          <Button
            size="small"
            variant="outlined"
            startIcon={rotating ? <CircularProgress size={16} /> : <RotateIcon />}
            onClick={handleTrigger}
            disabled={rotating}
          >
            Rotate Now
          </Button>
        )}
      </Box>

      {status?.enabled && (
        <Box sx={{ mb: 1.5 }}>
          <TextField
            label="Interval (days)"
            type="number"
            value={intervalDays}
            onChange={(e) => setIntervalDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            onBlur={() => {
              if (intervalDays !== status.intervalDays) {
                handleToggle(true);
              }
            }}
            size="small"
            disabled={isReadOnly || toggling}
            slotProps={{ htmlInput: { min: 1, max: 365 } }}
            sx={{ width: 140 }}
          />
          <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {status.lastRotatedAt && (
              <Chip label={`Last rotated: ${formatDate(status.lastRotatedAt)}`} size="small" variant="outlined" />
            )}
            {status.nextRotationAt && (
              <Chip label={`Next: ${formatDate(status.nextRotationAt)}`} size="small" color="info" variant="outlined" />
            )}
          </Box>
        </Box>
      )}

      {/* Rotation history */}
      {history.length > 0 && (
        <Accordion disableGutters elevation={0} variant="outlined" sx={{ mt: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="body2">
              Rotation History ({history.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Status</TableCell>
                  <TableCell>Trigger</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Tooltip title={entry.errorMessage ?? entry.status}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {STATUS_ICONS[entry.status]}
                          <Typography variant="caption">{entry.status}</Typography>
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{entry.trigger}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {entry.targetUser}@{entry.targetHost}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{formatDate(entry.createdAt)}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}
