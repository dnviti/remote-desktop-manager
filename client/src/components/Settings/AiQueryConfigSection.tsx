import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, Button, TextField, Alert, Box,
  Stack, MenuItem, Switch, FormControlLabel, CircularProgress,
} from '@mui/material';
import {
  AutoAwesome as AiIcon,
} from '@mui/icons-material';
import { getAiConfig, updateAiConfig } from '../../api/aiQuery.api';
import type { AiConfig } from '../../api/aiQuery.api';
import { extractApiError } from '../../utils/apiError';
import { useNotificationStore } from '../../store/notificationStore';

const PROVIDERS = [
  { value: 'none', label: 'None (Disabled)' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI / Compatible' },
];

export default function AiQueryConfigSection() {
  const notify = useNotificationStore((s) => s.notify);
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Form fields
  const [provider, setProvider] = useState('none');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [maxTokens, setMaxTokens] = useState(4000);
  const [dailyLimit, setDailyLimit] = useState(100);
  const [enabled, setEnabled] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await getAiConfig();
      setConfig(cfg);
      setProvider(cfg.provider);
      setModelId(cfg.modelId);
      setBaseUrl(cfg.baseUrl ?? '');
      setMaxTokens(cfg.maxTokensPerRequest);
      setDailyLimit(cfg.dailyRequestLimit);
      setEnabled(cfg.enabled);
      setApiKey('');
    } catch {
      // Non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      const update: Record<string, unknown> = {
        provider,
        modelId,
        baseUrl: baseUrl || null,
        maxTokensPerRequest: maxTokens,
        dailyRequestLimit: dailyLimit,
        enabled,
      };
      if (apiKey) {
        update.apiKey = apiKey;
      }
      const cfg = await updateAiConfig(update);
      setConfig(cfg);
      setApiKey('');
      notify('AI configuration saved', 'success');
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to save AI configuration'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <AiIcon color="primary" />
          <Typography variant="h6">AI Query Generation</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configure AI-powered natural language to SQL query generation. Users can ask questions in plain English and receive validated SELECT queries.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Stack spacing={2.5}>
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
            }
            label="Enable AI Query Generation"
          />

          <TextField
            select
            label="AI Provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            size="small"
            fullWidth
          >
            {PROVIDERS.map((p) => (
              <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
            ))}
          </TextField>

          {provider !== 'none' && (
            <>
              <TextField
                label="API Key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                size="small"
                fullWidth
                placeholder={config?.hasApiKey ? 'Leave empty to keep existing key' : 'Enter API key'}
                helperText={config?.hasApiKey ? 'An API key is configured. Enter a new value to replace it.' : 'Required. Your API key is encrypted at rest.'}
              />

              <TextField
                label="Model"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                size="small"
                fullWidth
                placeholder={provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'}
                helperText="Leave empty for provider default."
              />

              {provider === 'openai' && (
                <TextField
                  label="Base URL"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  size="small"
                  fullWidth
                  placeholder="https://api.openai.com/v1"
                  helperText="For OpenAI-compatible APIs (e.g., Azure, local LLMs). Leave empty for default."
                />
              )}

              <Stack direction="row" spacing={2}>
                <TextField
                  label="Max Tokens"
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 4000)}
                  size="small"
                  inputProps={{ min: 100, max: 16000 }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Daily Request Limit"
                  type="number"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(parseInt(e.target.value, 10) || 100)}
                  size="small"
                  inputProps={{ min: 1, max: 10000 }}
                  sx={{ flex: 1 }}
                  helperText="Per tenant per day"
                />
              </Stack>
            </>
          )}

          <Box>
            <Button
              variant="contained"
              onClick={handleSave}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : undefined}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
