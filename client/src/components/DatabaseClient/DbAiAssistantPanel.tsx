import { Loader2, Send, Shield, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ObjectRequest } from '../../api/aiQuery.api';

export type DbAiStep = 'idle' | 'analyzing' | 'permissions' | 'generating' | 'result' | 'error';

export interface DbAiResult {
  sql: string;
  explanation: string;
  firewallWarning?: string;
}

interface DbAiAssistantPanelProps {
  prompt: string;
  step: DbAiStep;
  result: DbAiResult | null;
  error: string;
  objectRequests: ObjectRequest[];
  approvals: Record<number, boolean>;
  showExplanation: boolean;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismissError: () => void;
  onToggleApproval: (index: number, checked: boolean) => void;
  onInsert: () => void;
  onToggleExplanation: () => void;
}

export default function DbAiAssistantPanel({
  prompt,
  step,
  result,
  error,
  objectRequests,
  approvals,
  showExplanation,
  onPromptChange,
  onGenerate,
  onConfirm,
  onCancel,
  onDismissError,
  onToggleApproval,
  onInsert,
  onToggleExplanation,
}: DbAiAssistantPanelProps) {
  const approvedCount = Object.values(approvals).filter(Boolean).length;

  return (
    <div className="border-b border-border p-3 bg-primary/[0.04]">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="size-[18px] text-primary" />
        <span className="text-sm font-semibold text-primary">AI Assistant</span>
      </div>

      {(step === 'idle' || step === 'error' || step === 'result') && (
        <div className="flex gap-2 items-start">
          <textarea
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="Describe the query you need in plain English..."
            className="flex-1 min-h-[40px] max-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 resize-none"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onGenerate();
              }
            }}
          />
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={!prompt.trim()}
            className="min-w-[90px] h-10"
          >
            Generate
          </Button>
        </div>
      )}

      {(step === 'analyzing' || step === 'generating') && (
        <div className="flex items-center gap-3 py-4 justify-center">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm text-muted-foreground">
            {step === 'analyzing' ? 'Analyzing which tables are needed...' : 'Generating SQL query...'}
          </span>
        </div>
      )}

      {step === 'permissions' && (
        <div className="mt-1">
          <h4 className="text-sm font-semibold mb-1 flex items-center gap-1">
            <Shield className="size-4 text-yellow-400" />
            Tables needed ({approvedCount}/{objectRequests.length} approved)
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            The AI identified these tables for your query. Approve which ones it can read:
          </p>

          <div className="flex flex-col gap-2 mb-4">
            {objectRequests.map((req, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg border border-border p-3',
                  approvals[i] && 'bg-accent/50',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="h-5">
                        {req.schema}
                      </Badge>
                      <span className="text-sm font-semibold">{req.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{req.reason}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-xs text-muted-foreground">
                      {approvals[i] ? 'Allow' : 'Deny'}
                    </span>
                    <Switch
                      checked={approvals[i] ?? false}
                      onCheckedChange={(checked) => onToggleApproval(i, checked)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={approvedCount === 0}
            >
              <Send className="size-4" />
              Generate with approved ({approvedCount})
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}

      {step === 'error' && error && (
        <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={onDismissError} className="text-red-400 hover:text-red-300 ml-2 text-xs">dismiss</button>
        </div>
      )}

      {step === 'result' && result && (
        <div className="mt-3">
          <div className="p-2 bg-background rounded border border-border font-mono text-[0.8125rem] whitespace-pre-wrap break-words max-h-[150px] overflow-auto">
            {result.sql}
          </div>

          {result.firewallWarning && (
            <div className="mt-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
              {result.firewallWarning}
            </div>
          )}

          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={onInsert}>
              Insert into editor
            </Button>
            {result.explanation && (
              <Button variant="ghost" size="sm" onClick={onToggleExplanation}>
                {showExplanation ? 'Hide explanation' : 'Explain'}
              </Button>
            )}
          </div>

          {showExplanation && result.explanation && (
            <p className="text-sm text-muted-foreground mt-2 pl-2 border-l-2 border-primary">
              {result.explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
