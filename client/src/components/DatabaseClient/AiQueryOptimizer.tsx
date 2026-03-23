import { useState, useCallback } from 'react';
import {
  Box, Typography, Button, Card, CardContent, CardActions, Chip,
  CircularProgress, Alert, Switch, FormControlLabel, Divider, Paper,
} from '@mui/material';
import {
  AutoFixHigh as OptimizeIcon,
  Check as CheckIcon,
  Close as DismissIcon,
  Refresh as RetryIcon,
  Security as PermissionIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import {
  optimizeQuery, continueOptimization,
  type OptimizeQueryResult, type DataRequest,
} from '../../api/aiQuery.api';
import { introspectDatabase, type IntrospectionType } from '../../api/database.api';
import { extractApiError } from '../../utils/apiError';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AiQueryOptimizerProps {
  sql: string;
  executionPlan: unknown;
  sessionId: string;
  dbProtocol: string;
  dbVersion?: string;
  schemaContext?: unknown;
  onApply?: (optimizedSql: string) => void;
  onDismiss?: () => void;
}

type Step = 'idle' | 'loading' | 'permissions' | 'result' | 'error';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiQueryOptimizer({
  sql, executionPlan, sessionId, dbProtocol, dbVersion, schemaContext,
  onApply, onDismiss,
}: AiQueryOptimizerProps) {
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<OptimizeQueryResult | null>(null);
  const [dataRequests, setDataRequests] = useState<DataRequest[]>([]);
  const [approvals, setApprovals] = useState<Record<number, boolean>>({});

  // ---- Step 1: Start optimization ----

  const handleOptimize = useCallback(async () => {
    setStep('loading');
    setError('');
    try {
      const res = await optimizeQuery({
        sql, executionPlan, sessionId, dbProtocol, dbVersion, schemaContext,
      });

      if (res.status === 'needs_data' && res.dataRequests) {
        setResult(res);
        setDataRequests(res.dataRequests);
        // Default all permissions to approved
        const defaultApprovals: Record<number, boolean> = {};
        res.dataRequests.forEach((_, i) => { defaultApprovals[i] = true; });
        setApprovals(defaultApprovals);
        setStep('permissions');
      } else {
        setResult(res);
        setStep('result');
      }
    } catch (err) {
      setError(extractApiError(err, 'Failed to start optimization'));
      setStep('error');
    }
  }, [sql, executionPlan, sessionId, dbProtocol, dbVersion, schemaContext]);

  // ---- Step 2: Submit approved data ----

  const handleSubmitApproved = useCallback(async () => {
    if (!result) return;
    setStep('loading');
    setError('');

    try {
      // Fetch approved introspection data
      const approvedData: Record<string, unknown> = {};

      for (let i = 0; i < dataRequests.length; i++) {
        if (!approvals[i]) continue;
        const req = dataRequests[i];

        if (req.type !== 'custom_query') {
          try {
            const introspectionResult = await introspectDatabase(
              sessionId,
              req.type as IntrospectionType,
              req.target,
            );
            approvedData[`${req.type}_${req.target}`] = introspectionResult.data;
          } catch {
            // Skip failed introspection — don't block optimization
            approvedData[`${req.type}_${req.target}`] = { error: 'fetch_failed' };
          }
        }
      }

      const res = await continueOptimization(result.conversationId, approvedData);
      setResult(res);
      setStep('result');
    } catch (err) {
      setError(extractApiError(err, 'Failed to continue optimization'));
      setStep('error');
    }
  }, [result, dataRequests, approvals, sessionId]);

  // ---- Render: Idle ----

  if (step === 'idle') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <Button
          variant="contained"
          startIcon={<OptimizeIcon />}
          onClick={handleOptimize}
          size="small"
        >
          Optimize with AI
        </Button>
      </Box>
    );
  }

  // ---- Render: Loading ----

  if (step === 'loading') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 3 }}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary">Analyzing query...</Typography>
      </Box>
    );
  }

  // ---- Render: Error ----

  if (step === 'error') {
    return (
      <Box sx={{ py: 2 }}>
        <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>
        <Button size="small" startIcon={<RetryIcon />} onClick={handleOptimize}>
          Retry
        </Button>
      </Box>
    );
  }

  // ---- Render: Permission requests ----

  if (step === 'permissions') {
    const approvedCount = Object.values(approvals).filter(Boolean).length;

    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="subtitle2" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <PermissionIcon fontSize="small" color="warning" />
          AI needs additional data ({approvedCount}/{dataRequests.length} approved)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Review and approve the data the AI needs to analyze your query:
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
          {dataRequests.map((req, i) => (
            <Card key={i} variant="outlined" sx={{ bgcolor: approvals[i] ? 'action.hover' : undefined }}>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Chip
                        label={req.type.replace(/_/g, ' ')}
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ height: 20, textTransform: 'capitalize' }}
                      />
                      <Typography variant="body2" fontWeight={600}>{req.target}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">{req.reason}</Typography>
                  </Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={approvals[i] ?? false}
                        onChange={(_, checked) => setApprovals((prev) => ({ ...prev, [i]: checked }))}
                        size="small"
                      />
                    }
                    label={approvals[i] ? 'Allow' : 'Deny'}
                    labelPlacement="start"
                    sx={{ ml: 2, mr: 0 }}
                  />
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<SendIcon />}
            onClick={handleSubmitApproved}
            disabled={approvedCount === 0}
          >
            Submit approved ({approvedCount})
          </Button>
          <Button size="small" color="inherit" onClick={onDismiss}>Cancel</Button>
        </Box>
      </Box>
    );
  }

  // ---- Render: Result ----

  if (step === 'result' && result) {
    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="subtitle2" gutterBottom>AI Optimization Result</Typography>

        {result.explanation && (
          <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, bgcolor: 'action.hover' }}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {result.explanation}
            </Typography>
          </Paper>
        )}

        {result.changes && result.changes.length > 0 && (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="caption" fontWeight={600} color="text.secondary" gutterBottom>
              Changes:
            </Typography>
            {result.changes.map((change, i) => (
              <Chip key={i} label={change} size="small" sx={{ mr: 0.5, mb: 0.5 }} />
            ))}
          </Box>
        )}

        {result.optimizedSql && result.optimizedSql !== sql && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary">Original</Typography>
                <Box
                  sx={{
                    mt: 0.5, p: 1, bgcolor: 'error.main', color: 'error.contrastText',
                    borderRadius: 1, fontFamily: 'monospace', fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                    opacity: 0.85,
                  }}
                >
                  {sql}
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" fontWeight={600} color="text.secondary">Optimized</Typography>
                <Box
                  sx={{
                    mt: 0.5, p: 1, bgcolor: 'success.main', color: 'success.contrastText',
                    borderRadius: 1, fontFamily: 'monospace', fontSize: '0.8rem',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto',
                  }}
                >
                  {result.optimizedSql}
                </Box>
              </Box>
            </Box>
          </>
        )}

        <CardActions sx={{ px: 0, pt: 1.5 }}>
          {result.optimizedSql && onApply && (
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckIcon />}
              onClick={() => onApply(result.optimizedSql ?? '')}
            >
              Apply to Editor
            </Button>
          )}
          <Button
            size="small"
            startIcon={<RetryIcon />}
            onClick={handleOptimize}
          >
            Re-optimize
          </Button>
          <Button
            size="small"
            color="inherit"
            startIcon={<DismissIcon />}
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        </CardActions>
      </Box>
    );
  }

  return null;
}
