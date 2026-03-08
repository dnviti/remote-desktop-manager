import { useState, useEffect } from 'react';
import {
  Card, CardContent, Typography, Select, MenuItem, Alert, Box,
  CircularProgress,
} from '@mui/material';
import { getVaultAutoLock, setVaultAutoLock, VaultAutoLockResponse } from '../../api/vault.api';

const OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Server default', value: null },
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '4 hours', value: 240 },
  { label: 'Never', value: 0 },
];

export default function VaultAutoLockSection() {
  const [data, setData] = useState<VaultAutoLockResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getVaultAutoLock()
      .then(setData)
      .catch(() => setError('Failed to load auto-lock preference'))
      .finally(() => setLoading(false));
  }, []);

  const handleChange = async (value: number | null) => {
    setError('');
    setSaving(true);
    try {
      const result = await setVaultAutoLock(value);
      setData(result);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to update auto-lock preference'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  const tenantMax = data?.tenantMaxMinutes;
  const isOptionDisabled = (value: number | null) => {
    if (tenantMax === null || tenantMax === undefined || tenantMax <= 0) return false;
    if (value === 0) return true; // "Never" blocked by tenant enforcement
    if (value !== null && value > tenantMax) return true;
    return false;
  };

  // Serialise select value: null → "default", number → string
  const selectValue = data?.autoLockMinutes === null ? 'default' : String(data?.autoLockMinutes);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>Vault Auto-Lock</Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Select
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              handleChange(v === 'default' ? null : Number(v));
            }}
            size="small"
            disabled={saving}
            sx={{ minWidth: 200 }}
          >
            {OPTIONS.map((opt) => {
              const val = opt.value === null ? 'default' : String(opt.value);
              return (
                <MenuItem key={val} value={val} disabled={isOptionDisabled(opt.value)}>
                  {opt.label}
                </MenuItem>
              );
            })}
          </Select>
          {saving && <CircularProgress size={20} />}
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Effective timeout: {data?.effectiveMinutes === 0 ? 'Never' : `${data?.effectiveMinutes} minutes`}
          {tenantMax != null && tenantMax > 0 && (
            <> · Organization enforces a maximum of {tenantMax} minutes</>
          )}
        </Typography>
      </CardContent>
    </Card>
  );
}
