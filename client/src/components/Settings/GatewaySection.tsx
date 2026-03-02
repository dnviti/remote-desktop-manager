import { useState, useEffect } from 'react';
import {
  Box, Button, Alert, CircularProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, Dialog, DialogTitle,
  DialogContent, DialogContentText, DialogActions, Typography, IconButton,
  Paper, TextField, Tooltip, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  PlayArrow as TestIcon, Router as RouterIcon, VpnKey as KeyIcon,
  ContentCopy as CopyIcon, Download as DownloadIcon,
  Refresh as RotateIcon, ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useAuthStore } from '../../store/authStore';
import { useGatewayStore } from '../../store/gatewayStore';
import { testGateway, downloadSshPrivateKey } from '../../api/gateway.api';
import type { GatewayData } from '../../api/gateway.api';
import GatewayDialog from '../gateway/GatewayDialog';

interface TestState {
  gatewayId: string;
  loading: boolean;
  result?: { reachable: boolean; latencyMs: number | null; error: string | null };
}

interface GatewaySectionProps {
  onNavigateToTab?: (tabId: string) => void;
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GatewaySection({ onNavigateToTab }: GatewaySectionProps) {
  const user = useAuthStore((s) => s.user);
  const gateways = useGatewayStore((s) => s.gateways);
  const loading = useGatewayStore((s) => s.loading);
  const fetchGateways = useGatewayStore((s) => s.fetchGateways);
  const deleteGatewayAction = useGatewayStore((s) => s.deleteGateway);
  const sshKeyPair = useGatewayStore((s) => s.sshKeyPair);
  const sshKeyLoading = useGatewayStore((s) => s.sshKeyLoading);
  const fetchSshKeyPair = useGatewayStore((s) => s.fetchSshKeyPair);
  const generateSshKeyPairAction = useGatewayStore((s) => s.generateSshKeyPair);
  const rotateSshKeyPairAction = useGatewayStore((s) => s.rotateSshKeyPair);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGateway, setEditingGateway] = useState<GatewayData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GatewayData | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [testStates, setTestStates] = useState<Record<string, TestState>>({});
  const [keyActionLoading, setKeyActionLoading] = useState(false);
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasTenant = Boolean(user?.tenantId);
  const isAdmin = user?.tenantRole === 'OWNER' || user?.tenantRole === 'ADMIN';

  useEffect(() => {
    if (hasTenant) {
      fetchGateways();
      if (isAdmin) fetchSshKeyPair();
    }
  }, [fetchGateways, fetchSshKeyPair, hasTenant, isAdmin]);

  const handleEdit = (gw: GatewayData) => {
    setEditingGateway(gw);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await deleteGatewayAction(deleteTarget.id);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to delete gateway'
      );
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleTest = async (gw: GatewayData) => {
    setTestStates((prev) => ({
      ...prev,
      [gw.id]: { gatewayId: gw.id, loading: true },
    }));
    try {
      const result = await testGateway(gw.id);
      setTestStates((prev) => ({
        ...prev,
        [gw.id]: { gatewayId: gw.id, loading: false, result },
      }));
    } catch {
      setTestStates((prev) => ({
        ...prev,
        [gw.id]: {
          gatewayId: gw.id,
          loading: false,
          result: { reachable: false, latencyMs: null, error: 'Test request failed' },
        },
      }));
    }
  };

  const handleGenerateKeyPair = async () => {
    setKeyActionLoading(true);
    setError('');
    try {
      await generateSshKeyPairAction();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to generate SSH key pair'
      );
    } finally {
      setKeyActionLoading(false);
    }
  };

  const handleRotateKeyPair = async () => {
    setRotateConfirmOpen(false);
    setKeyActionLoading(true);
    setError('');
    try {
      await rotateSshKeyPairAction();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to rotate SSH key pair'
      );
    } finally {
      setKeyActionLoading(false);
    }
  };

  const handleCopyPublicKey = async () => {
    if (!sshKeyPair) return;
    await navigator.clipboard.writeText(sshKeyPair.publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPublicKey = () => {
    if (!sshKeyPair) return;
    triggerDownload(sshKeyPair.publicKey, 'tenant_ed25519.pub');
  };

  const handleDownloadPrivateKey = async () => {
    setError('');
    try {
      const pem = await downloadSshPrivateKey();
      triggerDownload(pem, 'tenant_ed25519');
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to download private key'
      );
    }
  };

  if (!hasTenant) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="h6" gutterBottom>No Organization</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          You need to create or join an organization before managing gateways.
        </Typography>
        <Button variant="contained" onClick={() => onNavigateToTab?.('organization')}>
          Set Up Organization
        </Button>
      </Box>
    );
  }

  return (
    <>
      {/* SSH Key Pair Section (Admin only) */}
      {isAdmin && (
        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <KeyIcon sx={{ mr: 1, color: 'text.secondary' }} />
            <Typography variant="h6" sx={{ flexGrow: 1 }}>SSH Key Pair</Typography>
          </Box>

          {sshKeyLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : !sshKeyPair ? (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No SSH key pair generated. Generate one to use Managed SSH gateways.
              </Typography>
              <Button
                variant="contained"
                startIcon={<KeyIcon />}
                onClick={handleGenerateKeyPair}
                disabled={keyActionLoading}
              >
                {keyActionLoading ? 'Generating...' : 'Generate Key Pair'}
              </Button>
            </Box>
          ) : (
            <Box>
              <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
                <Chip label={`Algorithm: ${sshKeyPair.algorithm.toUpperCase()}`} size="small" variant="outlined" />
                <Chip label={sshKeyPair.fingerprint} size="small" variant="outlined" />
                <Chip
                  label={`Created: ${new Date(sshKeyPair.createdAt).toLocaleDateString()}`}
                  size="small"
                  variant="outlined"
                />
              </Box>

              <TextField
                label="Public Key"
                value={sshKeyPair.publicKey}
                fullWidth
                multiline
                minRows={1}
                maxRows={3}
                slotProps={{ input: { readOnly: true } }}
                sx={{ mb: 2, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: '0.75rem' } }}
              />

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                <Tooltip title={copied ? 'Copied!' : 'Copy public key'}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<CopyIcon />}
                    onClick={handleCopyPublicKey}
                  >
                    {copied ? 'Copied' : 'Copy Public Key'}
                  </Button>
                </Tooltip>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadPublicKey}
                >
                  Download Public Key
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleDownloadPrivateKey}
                >
                  Download Private Key
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  startIcon={<RotateIcon />}
                  onClick={() => setRotateConfirmOpen(true)}
                  disabled={keyActionLoading}
                >
                  {keyActionLoading ? 'Rotating...' : 'Rotate Key Pair'}
                </Button>
              </Box>

              <Accordion disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="body2">How to use this key</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" color="text.secondary">
                    Copy this public key and add it to the <code>SSH_AUTHORIZED_KEYS</code> environment
                    variable of your SSH gateway container, or mount it as <code>/config/authorized_keys</code>.
                    The server will use the corresponding private key to authenticate automatically.
                  </Typography>
                </AccordionDetails>
              </Accordion>
            </Box>
          )}
        </Paper>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

      {/* Gateways Table Section */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Gateways</Typography>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => { setEditingGateway(null); setDialogOpen(true); }}
        >
          New Gateway
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : gateways.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <RouterIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h6" gutterBottom>No Gateways Yet</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Add a gateway to route connections through GUACD or SSH bastion hosts.
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setEditingGateway(null); setDialogOpen(true); }}
          >
            Add Gateway
          </Button>
        </Box>
      ) : (
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Host</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {gateways.map((gw) => {
                const test = testStates[gw.id];
                return (
                  <TableRow key={gw.id}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2">{gw.name}</Typography>
                        {gw.isDefault && (
                          <Chip label="Default" size="small" color="primary" variant="outlined" />
                        )}
                      </Box>
                      {gw.description && (
                        <Typography variant="caption" color="text.secondary">
                          {gw.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={gw.type === 'GUACD' ? 'GUACD' : 'SSH Bastion'}
                        size="small"
                        color={gw.type === 'GUACD' ? 'info' : 'warning'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{gw.host}:{gw.port}</Typography>
                    </TableCell>
                    <TableCell>
                      {test?.loading ? (
                        <CircularProgress size={16} />
                      ) : test?.result ? (
                        test.result.reachable ? (
                          <Chip
                            label={`Reachable${test.result.latencyMs != null ? ` (${test.result.latencyMs}ms)` : ''}`}
                            size="small"
                            color="success"
                          />
                        ) : (
                          <Chip
                            label={test.result.error || 'Unreachable'}
                            size="small"
                            color="error"
                          />
                        )
                      ) : (
                        <Typography variant="caption" color="text.secondary">Not tested</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => handleTest(gw)} title="Test connectivity">
                        <TestIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => handleEdit(gw)} title="Edit">
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => setDeleteTarget(gw)} title="Delete">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <GatewayDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingGateway(null); }}
        gateway={editingGateway}
      />

      {/* Delete gateway confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Gateway</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
            Connections using this gateway will revert to direct connection.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rotate key pair confirmation */}
      <Dialog open={rotateConfirmOpen} onClose={() => setRotateConfirmOpen(false)}>
        <DialogTitle>Rotate SSH Key Pair</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will generate a new SSH key pair and replace the current one.
            You will need to update the <code>SSH_AUTHORIZED_KEYS</code> or <code>/config/authorized_keys</code> on
            all SSH gateway containers with the new public key. Existing connections through managed gateways
            will fail until updated.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRotateConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleRotateKeyPair} color="warning" variant="contained" disabled={keyActionLoading}>
            {keyActionLoading ? 'Rotating...' : 'Rotate'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
