import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X, Copy, GitBranch, Clock, Table2, Ban, List, Check, Loader2, Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
  storedExecutionPlan?: Record<string, unknown> | null;
  onApplySql?: (sql: string) => void;
  aiQueryOptimizerEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function QueryVisualizer({
  open, onClose, queryText, queryType, executionTimeMs, rowsAffected,
  tablesAccessed, blocked, blockReason, sessionId, dbProtocol, storedExecutionPlan, onApplySql, aiQueryOptimizerEnabled = true,
}: QueryVisualizerProps) {
  const [copied, setCopied] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [planResult, setPlanResult] = useState<ExecutionPlanResponse | null>(null);
  const [showAiOptimizer, setShowAiOptimizer] = useState(false);

  const unsupportedProtocols = ['mongodb', 'db2'];
  const canExplain = sessionId && dbProtocol && !unsupportedProtocols.includes(dbProtocol) && !blocked;
  const hasStoredPlan = storedExecutionPlan != null && 'supported' in storedExecutionPlan;

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
    ? 'text-muted-foreground border-border'
    : executionTimeMs < 100
      ? 'text-green-400 border-green-500/30'
      : executionTimeMs < 1000
        ? 'text-yellow-400 border-yellow-500/30'
        : 'text-red-400 border-red-500/30';

  const durationBarColor = executionTimeMs == null
    ? 'bg-primary'
    : executionTimeMs < 100
      ? 'bg-green-500'
      : executionTimeMs < 1000
        ? 'bg-yellow-500'
        : 'bg-red-500';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0" showCloseButton={false}>
        {/* Header bar */}
        <div className="flex items-center px-4 py-2 border-b border-border bg-card">
          <Button variant="ghost" size="icon" className="size-8 mr-2" onClick={onClose}>
            <X className="size-4" />
          </Button>
          <span className="flex-1 text-base font-semibold">Query Visualizer</span>
          <Badge
            variant="outline"
            className={cn(blocked ? 'text-red-400 border-red-500/30' : 'text-primary border-primary/30')}
          >
            {queryType}
          </Badge>
        </div>

        <div className="p-4 overflow-auto max-h-[calc(90vh-56px)]">
          {/* Section 1: SQL */}
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-semibold">SQL Query</h4>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              title={copied ? 'Copied!' : 'Copy to clipboard'}
              onClick={handleCopy}
            >
              {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <div className="p-3 mb-5 font-mono text-[0.85rem] whitespace-pre-wrap break-all max-h-[250px] overflow-auto bg-[#111] text-gray-100 rounded border border-border">
            {queryText}
          </div>

          {/* Section 2: Execution metadata */}
          <h4 className="text-sm font-semibold mb-2">Execution Metadata</h4>
          <div className="flex flex-wrap gap-2 mb-5">
            <Badge variant="outline" className={cn('gap-1', durationColor)}>
              <Clock className="size-3" />
              {executionTimeMs != null ? `${executionTimeMs} ms` : 'N/A'}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <List className="size-3" />
              {rowsAffected != null ? `${rowsAffected.toLocaleString()} rows` : 'N/A'}
            </Badge>
            {tablesAccessed.length > 0 && tablesAccessed.map((t) => (
              <Badge key={t} variant="outline" className="gap-1">
                <Table2 className="size-3" />
                {t}
              </Badge>
            ))}
            {blocked && (
              <Badge variant="destructive" className="gap-1">
                <Ban className="size-3" />
                Blocked
              </Badge>
            )}
            {blockReason && !blocked && (
              <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30">
                Alert: {blockReason}
              </Badge>
            )}
          </div>

          {/* Timeline bar */}
          {executionTimeMs != null && (
            <div className="mb-5">
              <span className="text-xs text-muted-foreground">Duration</span>
              <div className="relative h-2 bg-accent/50 rounded overflow-hidden mt-1">
                <div
                  className={cn('absolute left-0 top-0 h-full rounded transition-[width] duration-500', durationBarColor)}
                  style={{ width: `${Math.min(100, (executionTimeMs / 5000) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <Separator className="mb-4" />

          {/* Section 3: Execution Plan */}
          <div className="flex items-center gap-2 mb-2">
            <GitBranch className="size-4" />
            <h4 className="text-sm font-semibold">Execution Plan</h4>
          </div>

          {/* Stored plan from audit log */}
          {hasStoredPlan && (
            <div className="mb-5">
              {storedExecutionPlan.supported ? (
                <ExecutionPlanTree
                  plan={storedExecutionPlan.plan}
                  format={(storedExecutionPlan.format as 'json' | 'xml' | 'text') ?? 'json'}
                  raw={storedExecutionPlan.raw as string | undefined}
                />
              ) : (
                <div className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400 flex items-center gap-2">
                  <Info className="size-4 shrink-0" />
                  Execution plans are not supported for this database protocol.
                </div>
              )}
            </div>
          )}

          {/* Live session plan fetch */}
          {!hasStoredPlan && !canExplain && (
            <div className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400 mb-4 flex items-center gap-2">
              <Info className="size-4 shrink-0" />
              {blocked
                ? 'Execution plan is not available for blocked queries.'
                : !sessionId
                  ? 'No persisted execution plan is stored for this audit entry. Enable execution plan persistence on the connection to retain plans after the session closes.'
                  : unsupportedProtocols.includes(dbProtocol ?? '')
                    ? `Execution plans are not supported for ${dbProtocol}.`
                    : 'Execution plan is not available.'}
            </div>
          )}

          {!hasStoredPlan && canExplain && !planResult && !planLoading && !planError && (
            <p className="text-sm text-muted-foreground mb-4">
              Waiting for query execution...
            </p>
          )}

          {!hasStoredPlan && planLoading && (
            <div className="flex items-center gap-2 mb-4">
              <Loader2 className="size-5 animate-spin" />
              <span className="text-sm text-muted-foreground">Fetching execution plan...</span>
            </div>
          )}

          {!hasStoredPlan && planError && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 mb-4 flex items-center justify-between">
              <span>{planError}</span>
              <Button variant="ghost" size="sm" onClick={handleGetPlan}>Retry</Button>
            </div>
          )}

          {!hasStoredPlan && planResult && (
            <div className="mb-5">
              {planResult.supported ? (
                <ExecutionPlanTree
                  plan={planResult.plan}
                  format={planResult.format ?? 'json'}
                  raw={planResult.raw}
                />
              ) : (
                <div className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400 flex items-center gap-2">
                  <Info className="size-4 shrink-0" />
                  Execution plans are not supported for this database protocol.
                </div>
              )}
            </div>
          )}

          {/* Section 4: AI Optimization */}
          {canExplain && aiQueryOptimizerEnabled && (
            <>
              <Separator className="mb-4" />
              <h4 className="text-sm font-semibold mb-2">AI Query Optimization</h4>

              {!showAiOptimizer ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAiOptimizer(true)}
                  className="mb-4"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
