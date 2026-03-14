import { useState, useEffect, KeyboardEvent } from 'react';
import {
  Card, CardContent, Typography, Switch, FormControlLabel, Alert, CircularProgress,
  Box, RadioGroup, Radio, TextField, Button, Chip, Stack, Divider,
} from '@mui/material';
import { useAuthStore } from '../../store/authStore';
import { getIpAllowlist, updateIpAllowlist, IpAllowlistData } from '../../api/tenant.api';
import { extractApiError } from '../../utils/apiError';

// Simple client-side CIDR / IP validation
// eslint-disable-next-line security/detect-unsafe-regex
const CIDR_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/;

function expandIPv6(ip: string): string | null {
  if (!ip.includes('::')) return ip;
  const sides = ip.split('::');
  if (sides.length !== 2) return null;
  const left = sides[0] ? sides[0].split(':') : [];
  const right = sides[1] ? sides[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array(missing).fill('0'), ...right].join(':');
}

function ipv6ToBigInt(ip: string): bigint | null {
  try {
    const expanded = expandIPv6(ip);
    if (!expanded) return null;
    const groups = expanded.split(':');
    if (groups.length !== 8) return null;
    let result = BigInt(0);
    for (const g of groups) result = (result << BigInt(16)) | BigInt(parseInt(g, 16));
    return result;
  } catch { return null; }
}

/** Client-side CIDR check for the "Test IP" feature — supports IPv4 and IPv6. */
function isIpInCidr(ip: string, cidr: string): boolean {
  try {
    const slash = cidr.lastIndexOf('/');
    if (slash === -1) return ip === cidr;
    const base = cidr.slice(0, slash);
    const prefix = parseInt(cidr.slice(slash + 1), 10);

    if (base.includes(':')) {
      // IPv6
      const ipBig = ipv6ToBigInt(ip);
      const baseBig = ipv6ToBigInt(base);
      if (ipBig === null || baseBig === null) return false;
      const bits = BigInt(128);
      const p = BigInt(prefix);
      // mask = all-ones for the top `prefix` bits, zeroes for the rest
      const allOnes = (BigInt(1) << bits) - BigInt(1);
      const trailingZeros = prefix === 0 ? allOnes : (BigInt(1) << (bits - p)) - BigInt(1);
      const mask = prefix === 0 ? BigInt(0) : allOnes ^ trailingZeros;
      return (ipBig & mask) === (baseBig & mask);
    }
    // IPv4
    const toInt = (a: string) => a.split('.').reduce((acc, o) => (acc << 8) | parseInt(o, 10), 0) >>> 0;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (toInt(ip) & mask) === (toInt(base) & mask);
  } catch { return false; }
}

function isValidEntry(entry: string): boolean {
  return CIDR_RE.test(entry.trim());
}

export default function IpAllowlistSection() {
  const user = useAuthStore((s) => s.user);
  const tenantId = user?.tenantId;

  const [config, setConfig] = useState<IpAllowlistData>({ enabled: false, mode: 'flag', entries: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Input state for adding a new CIDR entry
  const [newEntry, setNewEntry] = useState('');
  const [entryError, setEntryError] = useState('');

  // Test IP state
  const [testIp, setTestIp] = useState('');
  const [testResult, setTestResult] = useState<'allowed' | 'blocked' | null>(null);

  useEffect(() => {
    if (!tenantId) { setLoading(false); return; }
    getIpAllowlist(tenantId)
      .then((data) => { setConfig(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const updated = await updateIpAllowlist(tenantId, config);
      setConfig(updated);
      setSuccess(true);
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to save IP allowlist settings'));
    } finally {
      setSaving(false);
    }
  };

  const handleAddEntry = () => {
    const trimmed = newEntry.trim();
    if (!trimmed) return;
    if (!isValidEntry(trimmed)) { setEntryError('Invalid IP or CIDR format (e.g. 10.0.0.0/8)'); return; }
    if (config.entries.includes(trimmed)) { setEntryError('Entry already exists'); return; }
    setConfig((prev) => ({ ...prev, entries: [...prev.entries, trimmed] }));
    setNewEntry('');
    setEntryError('');
    setTestResult(null);
  };

  const handleEntryKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAddEntry(); }
  };

  const handleRemoveEntry = (entry: string) => {
    setConfig((prev) => ({ ...prev, entries: prev.entries.filter((e) => e !== entry) }));
    setTestResult(null);
  };

  const handleTestIp = () => {
    if (!testIp.trim()) return;
    if (config.entries.length === 0) { setTestResult('allowed'); return; }
    const matched = config.entries.some((cidr) => isIpInCidr(testIp.trim(), cidr));
    setTestResult(matched ? 'allowed' : 'blocked');
  };

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  if (!tenantId) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
          IP Allowlist
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Restrict logins to trusted IP addresses and CIDR ranges. When disabled, all IPs are allowed.
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>Settings saved successfully.</Alert>}

        {/* Enable toggle */}
        <FormControlLabel
          control={
            <Switch
              checked={config.enabled}
              onChange={(e) => { setConfig((prev) => ({ ...prev, enabled: e.target.checked })); setSuccess(false); }}
              disabled={saving}
            />
          }
          label="Enable IP allowlist"
        />

        {config.enabled && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            {/* Mode selector */}
            <Box>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Enforcement mode
              </Typography>
              <RadioGroup
                value={config.mode}
                onChange={(e) => { setConfig((prev) => ({ ...prev, mode: e.target.value as 'flag' | 'block' })); setSuccess(false); }}
              >
                <FormControlLabel
                  value="flag"
                  control={<Radio size="small" disabled={saving} />}
                  label={
                    <Box>
                      <Typography variant="body2">Flag suspicious logins</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Logins from unlisted IPs are allowed but marked in the audit log
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="block"
                  control={<Radio size="small" disabled={saving} />}
                  label={
                    <Box>
                      <Typography variant="body2">Block unauthorized logins</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Logins from unlisted IPs are rejected with a 403 error
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </Box>

            {config.mode === 'block' && (
              <Alert severity="warning">
                Block mode will prevent all logins from IPs not in the allowlist. Ensure your own IP
                is included before saving, or you may lock yourself out.
              </Alert>
            )}

            <Divider />

            {/* CIDR entry input */}
            <Box>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Trusted IPs / CIDR ranges
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                  size="small"
                  placeholder="e.g. 10.0.0.0/8 or 203.0.113.5"
                  value={newEntry}
                  onChange={(e) => { setNewEntry(e.target.value); setEntryError(''); }}
                  onKeyDown={handleEntryKeyDown}
                  error={!!entryError}
                  helperText={entryError}
                  disabled={saving}
                  sx={{ flex: 1 }}
                />
                <Button variant="outlined" size="small" onClick={handleAddEntry} disabled={saving || !newEntry.trim()}>
                  Add
                </Button>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minHeight: 32 }}>
                {config.entries.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    No entries — all IPs are treated as {config.mode === 'block' ? 'blocked' : 'untrusted'}
                  </Typography>
                )}
                {config.entries.map((entry) => (
                  <Chip
                    key={entry}
                    label={entry}
                    size="small"
                    variant="outlined"
                    onDelete={() => handleRemoveEntry(entry)}
                    disabled={saving}
                  />
                ))}
              </Box>
            </Box>

            <Divider />

            {/* Test IP */}
            <Box>
              <Typography variant="body2" fontWeight="medium" gutterBottom>
                Test an IP address
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  size="small"
                  placeholder="e.g. 10.1.2.3"
                  value={testIp}
                  onChange={(e) => { setTestIp(e.target.value); setTestResult(null); }}
                  sx={{ flex: 1 }}
                />
                <Button variant="outlined" size="small" onClick={handleTestIp} disabled={!testIp.trim()}>
                  Check
                </Button>
              </Box>
              {testResult && (
                <Alert severity={testResult === 'allowed' ? 'success' : 'error'} sx={{ mt: 1 }}>
                  {testIp} would be <strong>{testResult}</strong> by the current allowlist.
                </Alert>
              )}
            </Box>
          </Stack>
        )}

        <Box sx={{ mt: 3 }}>
          <Button variant="contained" size="small" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
