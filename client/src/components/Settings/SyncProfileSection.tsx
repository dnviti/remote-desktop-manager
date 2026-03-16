import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, Button, TextField, Alert, Box, Chip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Switch,
  Select, MenuItem, InputLabel, FormControl, Tooltip,
  Collapse,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Sync as SyncIcon,
  NetworkCheck as TestIcon,
  ExpandMore as ExpandIcon,
  ExpandLess as CollapseIcon,
  Schedule as ScheduleIcon,
} from '@mui/icons-material';
import {
  listSyncProfiles, createSyncProfile, updateSyncProfile, deleteSyncProfile,
  testSyncConnection, triggerSync, getSyncLogs,
} from '../../api/sync.api';
import type { SyncProfileData, SyncLogEntry, SyncPlanData, CreateSyncProfileInput, UpdateSyncProfileInput } from '../../api/sync.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { extractApiError } from '../../utils/apiError';
import { useNotificationStore } from '../../store/notificationStore';
import SyncPreviewDialog from './SyncPreviewDialog';

const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  SUCCESS: 'success',
  ERROR: 'error',
  PARTIAL: 'warning',
  RUNNING: 'info',
  PENDING: 'default',
};

export default function SyncProfileSection() {
  const notify = useNotificationStore((s) => s.notify);
  const [profiles, setProfiles] = useState<SyncProfileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SyncProfileData | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<SyncLogEntry[]>([]);
  const [previewPlan, setPreviewPlan] = useState<SyncPlanData | null>(null);
  const [previewProfileId, setPreviewProfileId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snackError, setSnackError] = useState('');

  // Form state
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formApiToken, setFormApiToken] = useState('');
  const [formFilters, setFormFilters] = useState('');
  const [formPlatformMapping, setFormPlatformMapping] = useState('');
  const [formDefaultProtocol, setFormDefaultProtocol] = useState('SSH');
  const [formConflictStrategy, setFormConflictStrategy] = useState('update');
  const [formCronExpression, setFormCronExpression] = useState('');
  const [formTeamId, setFormTeamId] = useState('');

  const { loading: actionLoading, error: actionError, run } = useAsyncAction();

  const loadProfiles = useCallback(async () => {
    try {
      const data = await listSyncProfiles();
      setProfiles(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const resetForm = () => {
    setFormName('');
    setFormUrl('');
    setFormApiToken('');
    setFormFilters('');
    setFormPlatformMapping('');
    setFormDefaultProtocol('SSH');
    setFormConflictStrategy('update');
    setFormCronExpression('');
    setFormTeamId('');
  };

  const openCreate = () => {
    setEditingProfile(null);
    resetForm();
    setEditOpen(true);
  };

  const openEdit = (profile: SyncProfileData) => {
    setEditingProfile(profile);
    setFormName(profile.name);
    setFormUrl(profile.config.url);
    setFormApiToken('');
    setFormFilters(Object.entries(profile.config.filters || {}).map(([k, v]) => `${k}=${v}`).join(', '));
    setFormPlatformMapping(Object.entries(profile.config.platformMapping || {}).map(([k, v]) => `${k}=${v}`).join(', '));
    setFormDefaultProtocol(profile.config.defaultProtocol || 'SSH');
    setFormConflictStrategy(profile.config.conflictStrategy || 'update');
    setFormCronExpression(profile.cronExpression || '');
    setFormTeamId(profile.teamId || '');
    setEditOpen(true);
  };

  const parseKeyValuePairs = (input: string): Record<string, string> => {
    if (!input.trim()) return {};
    return Object.fromEntries(
      input.split(',').map((pair) => {
        const [key, ...rest] = pair.split('=');
        return [key.trim(), rest.join('=').trim()];
      }).filter(([k]) => k),
    );
  };

  const handleSave = async () => {
    const filters = parseKeyValuePairs(formFilters);
    const platformMapping = parseKeyValuePairs(formPlatformMapping);

    if (editingProfile) {
      const input: UpdateSyncProfileInput = {
        name: formName,
        url: formUrl,
        filters,
        platformMapping,
        defaultProtocol: formDefaultProtocol,
        conflictStrategy: formConflictStrategy,
        cronExpression: formCronExpression || null,
        teamId: formTeamId || null,
      };
      if (formApiToken) input.apiToken = formApiToken;

      const ok = await run(async () => {
        await updateSyncProfile(editingProfile.id, input);
      }, 'Failed to update sync profile');
      if (ok) {
        setEditOpen(false);
        loadProfiles();
      }
    } else {
      if (!formApiToken) return;
      const input: CreateSyncProfileInput = {
        name: formName,
        provider: 'NETBOX',
        url: formUrl,
        apiToken: formApiToken,
        filters,
        platformMapping,
        defaultProtocol: formDefaultProtocol,
        conflictStrategy: formConflictStrategy,
        cronExpression: formCronExpression || undefined,
        teamId: formTeamId || undefined,
      };

      const ok = await run(async () => {
        await createSyncProfile(input);
      }, 'Failed to create sync profile');
      if (ok) {
        setEditOpen(false);
        loadProfiles();
      }
    }
  };

  const handleDelete = async (id: string) => {
    await run(async () => {
      await deleteSyncProfile(id);
      loadProfiles();
    }, 'Failed to delete sync profile');
  };

  const handleToggle = async (profile: SyncProfileData) => {
    await run(async () => {
      await updateSyncProfile(profile.id, { enabled: !profile.enabled });
      loadProfiles();
    }, 'Failed to toggle sync profile');
  };

  const handleTest = async (id: string) => {
    setSnackError('');
    try {
      const result = await testSyncConnection(id);
      if (result.ok) {
        notify('Connection successful', 'success');
      } else {
        setSnackError(`Connection failed: ${result.error}`);
      }
    } catch (err) {
      setSnackError(extractApiError(err, 'Connection test failed'));
    }
  };

  const handleSync = async (id: string) => {
    setSnackError('');
    try {
      const result = await triggerSync(id, true);
      setPreviewPlan(result.plan);
      setPreviewProfileId(id);
      setPreviewOpen(true);
    } catch (err) {
      setSnackError(extractApiError(err, 'Failed to run sync preview'));
    }
  };

  const handleConfirmSync = async () => {
    if (!previewProfileId) return;
    try {
      await triggerSync(previewProfileId, false);
      setPreviewOpen(false);
      setPreviewPlan(null);
      setPreviewProfileId(null);
      notify('Sync completed successfully', 'success');
      loadProfiles();
    } catch (err) {
      setSnackError(extractApiError(err, 'Sync failed'));
    }
  };

  const handleToggleLogs = async (profileId: string) => {
    if (expandedLogs === profileId) {
      setExpandedLogs(null);
      return;
    }
    try {
      const result = await getSyncLogs(profileId, 1, 10);
      setLogs(result.logs);
      setExpandedLogs(profileId);
    } catch {
      // ignore
    }
  };

  if (loading) return null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Box>
            <Typography variant="h6">Sync Profiles</Typography>
            <Typography variant="body2" color="text.secondary">
              Import connections from external sources like NetBox
            </Typography>
          </Box>
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={openCreate}>
            Add Profile
          </Button>
        </Stack>

        {snackError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSnackError('')}>{snackError}</Alert>}
        {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

        {profiles.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            No sync profiles configured. Add one to start importing connections.
          </Typography>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Last Sync</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Schedule</TableCell>
                  <TableCell align="center">Enabled</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography variant="body2">{profile.name}</Typography>
                        <IconButton size="small" onClick={() => handleToggleLogs(profile.id)}>
                          {expandedLogs === profile.id ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
                        </IconButton>
                      </Stack>
                      <Collapse in={expandedLogs === profile.id}>
                        <Box sx={{ mt: 1, pl: 1 }}>
                          {logs.length === 0 ? (
                            <Typography variant="caption" color="text.secondary">No sync history</Typography>
                          ) : (
                            <Stack spacing={0.5}>
                              {logs.map((log) => (
                                <Stack key={log.id} direction="row" spacing={1} alignItems="center">
                                  <Chip
                                    label={log.status}
                                    color={STATUS_COLORS[log.status] || 'default'}
                                    size="small"
                                    sx={{ minWidth: 70, fontSize: '0.7rem' }}
                                  />
                                  <Typography variant="caption">
                                    {new Date(log.startedAt).toLocaleString()}
                                  </Typography>
                                  {log.details && (
                                    <Typography variant="caption" color="text.secondary">
                                      {formatLogDetails(log.details)}
                                    </Typography>
                                  )}
                                </Stack>
                              ))}
                            </Stack>
                          )}
                        </Box>
                      </Collapse>
                    </TableCell>
                    <TableCell><Chip label={profile.provider} size="small" variant="outlined" /></TableCell>
                    <TableCell>
                      {profile.lastSyncAt
                        ? new Date(profile.lastSyncAt).toLocaleString()
                        : <Typography variant="caption" color="text.secondary">Never</Typography>}
                    </TableCell>
                    <TableCell>
                      {profile.lastSyncStatus && (
                        <Chip
                          label={profile.lastSyncStatus}
                          color={STATUS_COLORS[profile.lastSyncStatus] || 'default'}
                          size="small"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {profile.cronExpression ? (
                        <Tooltip title={profile.cronExpression}>
                          <Chip icon={<ScheduleIcon />} label="Scheduled" size="small" variant="outlined" />
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">Manual</Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={profile.enabled}
                        onChange={() => handleToggle(profile)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0} justifyContent="flex-end">
                        <Tooltip title="Test connection">
                          <IconButton size="small" onClick={() => handleTest(profile.id)}>
                            <TestIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Sync now">
                          <IconButton size="small" onClick={() => handleSync(profile.id)}>
                            <SyncIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openEdit(profile)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => handleDelete(profile.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>

      {/* Create / Edit dialog */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingProfile ? 'Edit Sync Profile' : 'Create Sync Profile'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              fullWidth
              required
              size="small"
            />
            <TextField
              label="NetBox URL"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              fullWidth
              required
              size="small"
              placeholder="https://netbox.example.com"
            />
            <TextField
              label="API Token"
              type="password"
              value={formApiToken}
              onChange={(e) => setFormApiToken(e.target.value)}
              fullWidth
              required={!editingProfile}
              size="small"
              placeholder={editingProfile ? 'Leave empty to keep current' : ''}
            />
            <TextField
              label="Filters"
              value={formFilters}
              onChange={(e) => setFormFilters(e.target.value)}
              fullWidth
              size="small"
              placeholder="site=dc1, status=active, tag=managed"
              helperText="Comma-separated key=value pairs"
            />
            <TextField
              label="Platform Mapping"
              value={formPlatformMapping}
              onChange={(e) => setFormPlatformMapping(e.target.value)}
              fullWidth
              size="small"
              placeholder="linux=SSH, windows=RDP, ubuntu=SSH"
              helperText="Map NetBox platform slugs to protocols"
            />
            <Stack direction="row" spacing={2}>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Default Protocol</InputLabel>
                <Select
                  value={formDefaultProtocol}
                  label="Default Protocol"
                  onChange={(e) => setFormDefaultProtocol(e.target.value)}
                >
                  <MenuItem value="SSH">SSH</MenuItem>
                  <MenuItem value="RDP">RDP</MenuItem>
                  <MenuItem value="VNC">VNC</MenuItem>
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Conflict Strategy</InputLabel>
                <Select
                  value={formConflictStrategy}
                  label="Conflict Strategy"
                  onChange={(e) => setFormConflictStrategy(e.target.value)}
                >
                  <MenuItem value="update">Update</MenuItem>
                  <MenuItem value="skip">Skip</MenuItem>
                  <MenuItem value="overwrite">Overwrite</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <TextField
              label="Cron Expression"
              value={formCronExpression}
              onChange={(e) => setFormCronExpression(e.target.value)}
              fullWidth
              size="small"
              placeholder="0 */6 * * * (every 6 hours)"
              helperText="Leave empty for manual sync only"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={actionLoading || !formName || !formUrl || (!editingProfile && !formApiToken)}
          >
            {actionLoading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <SyncPreviewDialog
        open={previewOpen}
        onClose={() => { setPreviewOpen(false); setPreviewPlan(null); }}
        onConfirm={handleConfirmSync}
        plan={previewPlan}
        confirming={actionLoading}
      />
    </Card>
  );
}

function formatLogDetails(details: Record<string, unknown>): string {
  if (details.dryRun) return '(dry run)';
  if (details.error) return `Error: ${details.error}`;
  const parts: string[] = [];
  if (typeof details.created === 'number') parts.push(`+${details.created}`);
  if (typeof details.updated === 'number') parts.push(`~${details.updated}`);
  if (typeof details.skipped === 'number') parts.push(`=${details.skipped}`);
  if (typeof details.failed === 'number' && details.failed > 0) parts.push(`!${details.failed}`);
  return parts.join(' ');
}
