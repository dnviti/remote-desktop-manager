import type { Dispatch, SetStateAction } from 'react';
import { Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DbSettings } from '../../api/connections.api';
import type { AiConfig, AiFeatureConfig } from '../../api/aiQuery.api';

interface ConnectionDialogDatabaseAISectionProps {
  aiConfig: AiConfig | null;
  dbSettings: Partial<DbSettings>;
  onChange: Dispatch<SetStateAction<Partial<DbSettings>>>;
  setOptionalString: <K extends keyof DbSettings>(key: K, value: string) => void;
}

function featureBackendLabel(feature: AiFeatureConfig | undefined) {
  if (!feature?.backend) {
    return 'Tenant default';
  }
  return `Tenant default (${feature.backend})`;
}

export default function ConnectionDialogDatabaseAISection({
  aiConfig,
  dbSettings,
  onChange,
  setOptionalString,
}: ConnectionDialogDatabaseAISectionProps) {
  const backendNames = aiConfig?.backends.map((backend) => backend.name) ?? [];
  const generationEnabled = dbSettings.aiQueryGenerationEnabled ?? aiConfig?.queryGeneration.enabled ?? false;
  const optimizerEnabled = dbSettings.aiQueryOptimizerEnabled ?? aiConfig?.queryOptimizer.enabled ?? false;

  return (
    <div className="rounded-lg border border-border/70 bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <div>
          <h4 className="text-sm font-semibold">Connection-level AI behavior</h4>
          <p className="text-xs text-muted-foreground">Choose whether this connection exposes AI generation and optimization, and which backend/model it should prefer.</p>
        </div>
      </div>

      {backendNames.length === 0 && (
        <div className="mb-4 rounded-md border border-yellow-600/50 bg-yellow-600/10 px-4 py-3 text-sm text-yellow-500">
          No named AI backends are configured yet. Per-connection backend selection will become available after an admin adds one in Settings.
        </div>
      )}

      <div className="space-y-4">
        <div className="rounded-md border border-border/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="db-ai-generation" className="font-normal">AI query generation</Label>
              <p className="text-xs text-muted-foreground">Natural-language query drafting inside the database editor.</p>
            </div>
            <Switch
              id="db-ai-generation"
              checked={generationEnabled}
              onCheckedChange={(checked) => onChange((prev) => ({ ...prev, aiQueryGenerationEnabled: checked }))}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Preferred backend</Label>
              <Select
                value={dbSettings.aiQueryGenerationBackend || '__default__'}
                onValueChange={(value) => onChange((prev) => ({
                  ...prev,
                  aiQueryGenerationBackend: value === '__default__' ? undefined : value,
                }))}
                disabled={backendNames.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={featureBackendLabel(aiConfig?.queryGeneration)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{featureBackendLabel(aiConfig?.queryGeneration)}</SelectItem>
                  {backendNames.map((backendName) => (
                    <SelectItem key={backendName} value={backendName}>{backendName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Model override</Label>
              <Input
                value={dbSettings.aiQueryGenerationModel ?? ''}
                onChange={(event) => setOptionalString('aiQueryGenerationModel', event.target.value)}
                placeholder={aiConfig?.queryGeneration.modelId || 'Use backend default model'}
              />
            </div>
          </div>
        </div>

        <div className="rounded-md border border-border/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <Label htmlFor="db-ai-optimizer" className="font-normal">AI query optimizer</Label>
              <p className="text-xs text-muted-foreground">Execution-plan-aware optimization suggestions in the query visualizer.</p>
            </div>
            <Switch
              id="db-ai-optimizer"
              checked={optimizerEnabled}
              onCheckedChange={(checked) => onChange((prev) => ({ ...prev, aiQueryOptimizerEnabled: checked }))}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Preferred backend</Label>
              <Select
                value={dbSettings.aiQueryOptimizerBackend || '__default__'}
                onValueChange={(value) => onChange((prev) => ({
                  ...prev,
                  aiQueryOptimizerBackend: value === '__default__' ? undefined : value,
                }))}
                disabled={backendNames.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={featureBackendLabel(aiConfig?.queryOptimizer)} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{featureBackendLabel(aiConfig?.queryOptimizer)}</SelectItem>
                  {backendNames.map((backendName) => (
                    <SelectItem key={backendName} value={backendName}>{backendName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Model override</Label>
              <Input
                value={dbSettings.aiQueryOptimizerModel ?? ''}
                onChange={(event) => setOptionalString('aiQueryOptimizerModel', event.target.value)}
                placeholder={aiConfig?.queryOptimizer.modelId || 'Use backend default model'}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
