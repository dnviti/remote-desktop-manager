import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Typography, Button, Dialog, DialogContent, IconButton, Chip, Divider,
  CircularProgress, Alert, Paper, Tooltip, AppBar, Toolbar,
} from '@mui/material';
import {
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  AccountTree as PlanIcon,
  Timer as TimerIcon,
  TableChart as TableIcon,
  Block as BlockIcon,
  ViewList as RowsIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { getExecutionPlan, type ExecutionPlanResponse } from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';
import ExecutionPlanTree from './ExecutionPlanTree';
import AiQueryOptimizer from './AiQueryOptimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueryVisualizerProps {
  open: boolean;
  onClose: () => void;
  queryText: string;
  queryType: string;
  executionTimeMs: number | null;
  rowsAffected: number | null;
  tablesAccessed: string[];
  blocked: boolean;
  blockReason?: string | null;
  sessionId?: string;
  dbProtocol?: string;
  onApplySql?: (sql: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QueryVisualizer({
  open, onClose, queryText, queryType, executionTimeMs, rowsAffected,
  tablesAccessed, blocked, blockReason, sessionId, dbProtocol, onApplySql,
}: QueryVisualizerProps) {
  const [copied, setCopied] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [planResult, setPlanResult] = useState<ExecutionPlanResponse | null>(null);
  const [showAiOptimizer, setShowAiOptimizer] = useState(false);

  const unsupportedProtocols = ['mongodb', 'db2'];
  const canExplain = sessionId && dbProtocol && !unsupportedProtocols.includes(dbProtocol) && !blocked;

  const handleCopy = useCallback(async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(queryText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard write can fail (non-secure context, permissions, etc.)
    }
  }, [queryText]);

  const lastFetchedSql = useRef<string>('');

  const handleGetPlan = useCallback(async () => {
    if (!sessionId) return;
    setPlanLoading(true);
    setPlanError('');
    try {
      const result = await getExecutionPlan(sessionId, queryText);
      setPlanResult(result);
      lastFetchedSql.current = queryText;
    } catch (err) {
      setPlanError(extractApiError(err, 'Failed to fetch execution plan'));
    } finally {
      setPlanLoading(false);
    }
  }, [sessionId, queryText]);

  // Auto-fetch execution plan when the dialog opens with a live session
  useEffect(() => {
    if (open && canExplain && !planResult && !planLoading && queryText.trim() && lastFetchedSql.current !== queryText) {
      handleGetPlan();
    }
  }, [open, canExplain, planResult, planLoading, queryText, handleGetPlan]);

  // Reset all state when SQL changes or dialog reopens for a different entry
  useEffect(() => {
    if (queryText !== lastFetchedSql.current) {
      setPlanResult(null);
      setPlanError('');
      setShowAiOptimizer(false);
    }
  }, [queryText]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setPlanResult(null);
      setPlanError('');
      setShowAiOptimizer(false);
      lastFetchedSql.current = '';
    }
  }, [open]);

  const durationColor = executionTimeMs == null
    ? 'default'
    : executionTimeMs < 100
      ? 'success'
      : executionTimeMs < 1000
        ? 'warning'
        : 'error';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { maxHeight: '90vh' } }}
    >
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar variant="dense">
          <IconButton edge="start" onClick={onClose} sx={{ mr: 1 }}>
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={{ flex: 1 }}>Query Visualizer</Typography>
          <Chip
            label={queryType}
            size="small"
            color={blocked ? 'error' : 'primary'}
            variant="outlined"
          />
        </Toolbar>
      </AppBar>

      <DialogContent sx={{ p: 2 }}>
        {/* Section 1: Syntax-highlighted SQL */}
        <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          SQL Query
          <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
            <IconButton size="small" onClick={handleCopy}>
              {copied ? <CheckIcon fontSize="small" color="success" /> : <CopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Typography>
        <Paper
          variant="outlined"
          sx={{
            p: 1.5, mb: 2.5, fontFamily: 'monospace', fontSize: '0.85rem',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 250,
            overflow: 'auto', bgcolor: 'grey.900', color: 'grey.100',
            borderRadius: 1,
          }}
        >
          {queryText}
        </Paper>

        {/* Section 2: Execution metadata */}
        <Typography variant="subtitle2" gutterBottom>Execution Metadata</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2.5 }}>
          <Chip
            icon={<TimerIcon />}
            label={executionTimeMs != null ? `${executionTimeMs} ms` : 'N/A'}
            size="small"
            color={durationColor as 'default' | 'success' | 'warning' | 'error'}
            variant="outlined"
          />
          <Chip
            icon={<RowsIcon />}
            label={rowsAffected != null ? `${rowsAffected.toLocaleString()} rows` : 'N/A'}
            size="small"
            variant="outlined"
          />
          {tablesAccessed.length > 0 && tablesAccessed.map((t) => (
            <Chip key={t} icon={<TableIcon />} label={t} size="small" variant="outlined" />
          ))}
          {blocked && (
            <Chip icon={<BlockIcon />} label="Blocked" size="small" color="error" />
          )}
          {blockReason && !blocked && (
            <Chip label={`Alert: ${blockReason}`} size="small" color="warning" />
          )}
        </Box>

        {/* Timeline bar */}
        {executionTimeMs != null && (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="caption" color="text.secondary">Duration</Typography>
            <Box sx={{ position: 'relative', height: 8, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden', mt: 0.5 }}>
              <Box
                sx={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  width: `${Math.min(100, (executionTimeMs / 5000) * 100)}%`,
                  bgcolor: durationColor === 'success' ? 'success.main'
                    : durationColor === 'warning' ? 'warning.main'
                      : durationColor === 'error' ? 'error.main' : 'primary.main',
                  borderRadius: 1,
                  transition: 'width 0.5s ease',
                }}
              />
            </Box>
          </Box>
        )}

        <Divider sx={{ mb: 2 }} />

        {/* Section 3: Execution Plan */}
        <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PlanIcon fontSize="small" />
          Execution Plan
        </Typography>

        {!canExplain && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {blocked
              ? 'Execution plan is not available for blocked queries.'
              : !sessionId
                ? 'No active session to fetch execution plan.'
                : unsupportedProtocols.includes(dbProtocol ?? '')
                  ? `Execution plans are not supported for ${dbProtocol}.`
                  : 'Execution plan is not available.'}
          </Alert>
        )}

        {canExplain && !planResult && !planLoading && !planError && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Waiting for query execution...
          </Typography>
        )}

        {planLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">Fetching execution plan...</Typography>
          </Box>
        )}

        {planError && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={
              <Button size="small" color="inherit" onClick={handleGetPlan}>
                Retry
              </Button>
            }
          >
            {planError}
          </Alert>
        )}

        {planResult && (
          <Box sx={{ mb: 2.5 }}>
            {planResult.supported ? (
              <ExecutionPlanTree
                plan={planResult.plan}
                format={planResult.format ?? 'json'}
                raw={planResult.raw}
              />
            ) : (
              <Alert severity="info">
                Execution plans are not supported for this database protocol.
              </Alert>
            )}
          </Box>
        )}

        {/* Section 4: AI Optimization */}
        {canExplain && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Typography variant="subtitle2" gutterBottom>AI Query Optimization</Typography>

            {!showAiOptimizer ? (
              <Button
                variant="outlined"
                size="small"
                onClick={() => setShowAiOptimizer(true)}
                sx={{ mb: 2 }}
              >
                Optimize with AI
              </Button>
            ) : (
              <AiQueryOptimizer
                sql={queryText}
                executionPlan={planResult?.plan ?? null}
                sessionId={sessionId ?? ''}
                dbProtocol={dbProtocol ?? ''}
                onApply={onApplySql}
                onDismiss={() => setShowAiOptimizer(false)}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
