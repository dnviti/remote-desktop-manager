import { useEffect, useMemo, useState } from 'react';
import {
  KeyRound, Loader2, Plus, Sparkles, Trash2,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  SettingsFieldCard,
  SettingsFieldGroup,
  SettingsLoadingState,
  SettingsPanel,
  SettingsStatusBadge,
  SettingsSwitchRow,
} from './settings-ui';
import { getAiConfig, updateAiConfig } from '../../api/aiQuery.api';
import type {
  AiBackendUpdate,
  AiConfig,
  AiFeatureConfig,
  AiFeatureUpdate,
  AiProvider,
} from '../../api/aiQuery.api';
import { useNotificationStore } from '../../store/notificationStore';
import { extractApiError } from '../../utils/apiError';

interface EditableBackend {
  name: string;
  provider: AiProvider;
  apiKey: string;
  hasApiKey: boolean;
  clearApiKey: boolean;
  baseUrl: string;
  defaultModel: string;
}

const PROVIDERS: Array<{ value: AiProvider; label: string }> = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'openai-compatible', label: 'OpenAI-Compatible' },
];

function normalizePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.round(value);
}

function nextBackendName(backends: EditableBackend[]): string {
  let index = backends.length + 1;
  while (backends.some((backend) => backend.name.trim().toLowerCase() === `backend-${index}`)) {
    index += 1;
  }
  return `backend-${index}`;
}

function toEditableBackends(config: AiConfig): EditableBackend[] {
  return config.backends.map((backend) => ({
    name: backend.name,
    provider: backend.provider,
    apiKey: '',
    hasApiKey: backend.hasApiKey,
    clearApiKey: false,
    baseUrl: backend.baseUrl ?? '',
    defaultModel: backend.defaultModel ?? '',
  }));
}

function toFeatureUpdate(feature: AiFeatureConfig, includeDailyLimit: boolean): AiFeatureUpdate {
  const update: AiFeatureUpdate = {
    enabled: feature.enabled,
    backend: feature.backend?.trim() || undefined,
    modelId: feature.modelId?.trim() || undefined,
    maxTokensPerRequest: normalizePositiveInt(feature.maxTokensPerRequest, 4096),
  };
  if (includeDailyLimit) {
    update.dailyRequestLimit = normalizePositiveInt(feature.dailyRequestLimit ?? 100, 100);
  }
  return update;
}

export default function AiQueryConfigSection() {
  const notify = useNotificationStore((state) => state.notify);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [backends, setBackends] = useState<EditableBackend[]>([]);
  const [queryGeneration, setQueryGeneration] = useState<AiFeatureConfig>({
    enabled: false,
    backend: '',
    modelId: '',
    maxTokensPerRequest: 4096,
    dailyRequestLimit: 100,
  });
  const [queryOptimizer, setQueryOptimizer] = useState<AiFeatureConfig>({
    enabled: false,
    backend: '',
    modelId: '',
    maxTokensPerRequest: 4096,
  });
  const [temperature, setTemperature] = useState(0.2);
  const [timeoutMs, setTimeoutMs] = useState(60000);

  const backendNames = useMemo(
    () => backends.map((backend) => backend.name.trim()).filter(Boolean),
    [backends],
  );

  const syncFromConfig = (nextConfig: AiConfig) => {
    setBackends(toEditableBackends(nextConfig));
    setQueryGeneration({
      enabled: nextConfig.queryGeneration.enabled,
      backend: nextConfig.queryGeneration.backend ?? '',
      modelId: nextConfig.queryGeneration.modelId ?? '',
      maxTokensPerRequest: nextConfig.queryGeneration.maxTokensPerRequest,
      dailyRequestLimit: nextConfig.queryGeneration.dailyRequestLimit ?? 100,
    });
    setQueryOptimizer({
      enabled: nextConfig.queryOptimizer.enabled,
      backend: nextConfig.queryOptimizer.backend ?? '',
      modelId: nextConfig.queryOptimizer.modelId ?? '',
      maxTokensPerRequest: nextConfig.queryOptimizer.maxTokensPerRequest,
    });
    setTemperature(nextConfig.temperature);
    setTimeoutMs(nextConfig.timeoutMs);
  };

  useEffect(() => {
    getAiConfig()
      .then(syncFromConfig)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const updateBackend = (index: number, updater: (backend: EditableBackend) => EditableBackend) => {
    setBackends((current) => current.map((backend, itemIndex) => (
      itemIndex === index ? updater(backend) : backend
    )));
  };

  const removeBackend = (name: string) => {
    setBackends((current) => current.filter((backend) => backend.name !== name));
    setQueryGeneration((current) => ({
      ...current,
      backend: current.backend === name ? '' : current.backend,
    }));
    setQueryOptimizer((current) => ({
      ...current,
      backend: current.backend === name ? '' : current.backend,
    }));
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);

    try {
      const seenNames = new Set<string>();
      const backendPayload: AiBackendUpdate[] = backends.map((backend) => {
        const name = backend.name.trim();
        if (!name) {
          throw new Error('Each AI backend needs a name');
        }
        const normalizedName = name.toLowerCase();
        if (seenNames.has(normalizedName)) {
          throw new Error(`AI backend name "${name}" is duplicated`);
        }
        seenNames.add(normalizedName);

        const payload: AiBackendUpdate = {
          name,
          provider: backend.provider,
          baseUrl: backend.baseUrl.trim() || null,
          defaultModel: backend.defaultModel.trim() || null,
        };
        if (backend.apiKey.trim()) {
          payload.apiKey = backend.apiKey.trim();
        }
        if (!backend.apiKey.trim() && backend.clearApiKey) {
          payload.clearApiKey = true;
        }
        return payload;
      });

      const nextConfig = await updateAiConfig({
        backends: backendPayload,
        queryGeneration: toFeatureUpdate(queryGeneration, true),
        queryOptimizer: toFeatureUpdate(queryOptimizer, false),
        temperature,
        timeoutMs: normalizePositiveInt(timeoutMs, 60000),
      });

      syncFromConfig(nextConfig);
      notify('AI configuration saved', 'success');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to save AI configuration'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SettingsPanel
        title="AI Query"
        description="Model-backed assistance for database users."
      >
        <SettingsLoadingState message="Loading AI configuration..." />
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel
      title="AI Query"
      description="Configure named AI backends, then choose the default backend/model used for query generation and optimization."
      heading={(
        <div className="flex flex-wrap items-center gap-2">
          <SettingsStatusBadge tone={queryGeneration.enabled ? 'success' : 'neutral'}>
            <Sparkles className="mr-1 size-3.5" />
            Generation {queryGeneration.enabled ? 'on' : 'off'}
          </SettingsStatusBadge>
          <SettingsStatusBadge tone={queryOptimizer.enabled ? 'success' : 'neutral'}>
            Optimizer {queryOptimizer.enabled ? 'on' : 'off'}
          </SettingsStatusBadge>
          <SettingsStatusBadge tone="neutral">
            {backends.length} backend{backends.length === 1 ? '' : 's'}
          </SettingsStatusBadge>
        </div>
      )}
      contentClassName="space-y-4"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <SettingsFieldGroup>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Named backends</h3>
            <p className="text-sm text-muted-foreground">Each backend can point at a different remote or local AI host and can keep its own API key.</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setBackends((current) => [...current, {
              name: nextBackendName(current),
              provider: 'openai',
              apiKey: '',
              hasApiKey: false,
              clearApiKey: false,
              baseUrl: '',
              defaultModel: '',
            }])}
          >
            <Plus className="size-4" />
            Add backend
          </Button>
        </div>

        {backends.length === 0 && (
          <Alert>
            <AlertDescription>No AI backends are configured yet. Add at least one backend before enabling query generation or query optimization.</AlertDescription>
          </Alert>
        )}

        {backends.map((backend, index) => (
          <div key={`${backend.name}-${index}`} className="rounded-xl border border-border/70 bg-card/40 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <span className="text-sm font-semibold">{backend.name || `Backend ${index + 1}`}</span>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeBackend(backend.name)}>
                <Trash2 className="size-4" />
                Remove
              </Button>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <SettingsFieldCard label="Backend name" description="Used in the feature selectors below.">
                <Input
                  value={backend.name}
                  onChange={(event) => updateBackend(index, (current) => ({ ...current, name: event.target.value }))}
                  aria-label={`Backend name ${index + 1}`}
                />
              </SettingsFieldCard>

              <SettingsFieldCard label="Provider" description="OpenAI, Anthropic, Ollama, or another OpenAI-compatible API.">
                <Select
                  value={backend.provider}
                  onValueChange={(value) => updateBackend(index, (current) => ({ ...current, provider: value as AiProvider }))}
                >
                  <SelectTrigger aria-label={`Backend provider ${index + 1}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingsFieldCard>

              <SettingsFieldCard label="Host / base URL" description="Optional for hosted APIs. Required for local or OpenAI-compatible backends.">
                <Input
                  value={backend.baseUrl}
                  onChange={(event) => updateBackend(index, (current) => ({ ...current, baseUrl: event.target.value }))}
                  placeholder={backend.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com'}
                  aria-label={`Backend base URL ${index + 1}`}
                />
              </SettingsFieldCard>

              <SettingsFieldCard label="Default model" description="Used when a feature does not override the model for this backend.">
                <Input
                  value={backend.defaultModel}
                  onChange={(event) => updateBackend(index, (current) => ({ ...current, defaultModel: event.target.value }))}
                  placeholder={backend.provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4.1'}
                  aria-label={`Backend default model ${index + 1}`}
                />
              </SettingsFieldCard>

              <SettingsFieldCard
                label="API key"
                description={backend.hasApiKey && !backend.clearApiKey
                  ? 'A key is already stored. Leave this blank to keep it.'
                  : 'Stored encrypted at rest. Ollama usually does not need one.'}
              >
                <div className="space-y-2">
                  <Input
                    type="password"
                    value={backend.apiKey}
                    onChange={(event) => updateBackend(index, (current) => ({
                      ...current,
                      apiKey: event.target.value,
                      clearApiKey: event.target.value ? false : current.clearApiKey,
                    }))}
                    placeholder={backend.hasApiKey ? 'Leave blank to keep existing key' : 'Enter API key'}
                    aria-label={`Backend API key ${index + 1}`}
                  />
                  {backend.hasApiKey && (
                    <Button
                      type="button"
                      variant={backend.clearApiKey ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateBackend(index, (current) => ({
                        ...current,
                        apiKey: '',
                        clearApiKey: !current.clearApiKey,
                      }))}
                    >
                      {backend.clearApiKey ? 'Stored key will be removed' : 'Remove stored key'}
                    </Button>
                  )}
                </div>
              </SettingsFieldCard>
            </div>
          </div>
        ))}
      </SettingsFieldGroup>

      <SettingsFieldGroup>
        <SettingsSwitchRow
          title="Enable Query Generation"
          description="Allow natural-language query drafting for database users."
          checked={queryGeneration.enabled}
          onCheckedChange={(enabled) => setQueryGeneration((current) => ({ ...current, enabled }))}
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard label="Query generation backend" description="Default backend used for natural-language query drafting.">
            <Select
              value={queryGeneration.backend || '__none__'}
              onValueChange={(value) => setQueryGeneration((current) => ({ ...current, backend: value === '__none__' ? '' : value }))}
            >
              <SelectTrigger aria-label="Query generation backend">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No backend selected</SelectItem>
                {backendNames.map((backendName) => (
                  <SelectItem key={backendName} value={backendName}>{backendName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsFieldCard>

          <SettingsFieldCard label="Query generation model" description="Optional per-feature model override.">
            <Input
              value={queryGeneration.modelId ?? ''}
              onChange={(event) => setQueryGeneration((current) => ({ ...current, modelId: event.target.value }))}
              aria-label="Query generation model"
            />
          </SettingsFieldCard>

          <SettingsFieldCard label="Generation max tokens" description="Upper bound for one generated response.">
            <Input
              type="number"
              min={100}
              max={32000}
              value={queryGeneration.maxTokensPerRequest}
              onChange={(event) => setQueryGeneration((current) => ({
                ...current,
                maxTokensPerRequest: Number.parseInt(event.target.value, 10) || 4096,
              }))}
              aria-label="Query generation max tokens"
            />
          </SettingsFieldCard>

          <SettingsFieldCard label="Generation daily limit" description="Tenant-wide generation cap per day.">
            <Input
              type="number"
              min={1}
              max={100000}
              value={queryGeneration.dailyRequestLimit ?? 100}
              onChange={(event) => setQueryGeneration((current) => ({
                ...current,
                dailyRequestLimit: Number.parseInt(event.target.value, 10) || 100,
              }))}
              aria-label="Query generation daily limit"
            />
          </SettingsFieldCard>
        </div>
      </SettingsFieldGroup>

      <SettingsFieldGroup>
        <SettingsSwitchRow
          title="Enable Query Optimizer"
          description="Allow execution-plan-aware optimization suggestions in the query visualizer."
          checked={queryOptimizer.enabled}
          onCheckedChange={(enabled) => setQueryOptimizer((current) => ({ ...current, enabled }))}
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard label="Query optimizer backend" description="Default backend used for optimization analysis.">
            <Select
              value={queryOptimizer.backend || '__none__'}
              onValueChange={(value) => setQueryOptimizer((current) => ({ ...current, backend: value === '__none__' ? '' : value }))}
            >
              <SelectTrigger aria-label="Query optimizer backend">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No backend selected</SelectItem>
                {backendNames.map((backendName) => (
                  <SelectItem key={backendName} value={backendName}>{backendName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsFieldCard>

          <SettingsFieldCard label="Query optimizer model" description="Optional per-feature model override.">
            <Input
              value={queryOptimizer.modelId ?? ''}
              onChange={(event) => setQueryOptimizer((current) => ({ ...current, modelId: event.target.value }))}
              aria-label="Query optimizer model"
            />
          </SettingsFieldCard>

          <SettingsFieldCard label="Optimizer max tokens" description="Upper bound for one optimization response.">
            <Input
              type="number"
              min={100}
              max={32000}
              value={queryOptimizer.maxTokensPerRequest}
              onChange={(event) => setQueryOptimizer((current) => ({
                ...current,
                maxTokensPerRequest: Number.parseInt(event.target.value, 10) || 4096,
              }))}
              aria-label="Query optimizer max tokens"
            />
          </SettingsFieldCard>
        </div>
      </SettingsFieldGroup>

      <SettingsFieldGroup>
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard label="Temperature" description="Sampling temperature shared by generation and optimizer requests.">
            <Input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(Number.parseFloat(event.target.value) || 0)}
              aria-label="AI temperature"
            />
          </SettingsFieldCard>

          <SettingsFieldCard label="Timeout (ms)" description="Request timeout used for both remote and local AI backends.">
            <Input
              type="number"
              min={1000}
              max={600000}
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(Number.parseInt(event.target.value, 10) || 60000)}
              aria-label="AI timeout"
            />
          </SettingsFieldCard>
        </div>

        <div className="flex justify-start">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </SettingsFieldGroup>
    </SettingsPanel>
  );
}
