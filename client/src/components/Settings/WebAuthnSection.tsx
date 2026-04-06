import { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, Typography, Button, TextField, Alert, Stack, Chip,
  List, ListItem, ListItemText, ListItemSecondaryAction, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from '@mui/material';
import { Delete as DeleteIcon, Edit as EditIcon, Key as KeyIcon } from '@mui/icons-material';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import {
  getWebAuthnStatus, getWebAuthnCredentials, getWebAuthnRegistrationOptions,
  registerWebAuthnCredential, removeWebAuthnCredential, renameWebAuthnCredential,
  type WebAuthnCredentialInfo,
} from '../../api/webauthn.api';
import { extractApiError } from '../../utils/apiError';
import { useNotificationStore } from '../../store/notificationStore';

export default function WebAuthnSection() {
  const notify = useNotificationStore((s) => s.notify);
  const [enabled, setEnabled] = useState(false);
  const [credentials, setCredentials] = useState<WebAuthnCredentialInfo[]>([]);
  const [statusLoading, setStatusLoading] = useState(true);
  const [browserSupported, setBrowserSupported] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [friendlyName, setFriendlyName] = useState('');
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [pendingCredential, setPendingCredential] = useState<unknown>(null);
  const [pendingChallenge, setPendingChallenge] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [status, creds] = await Promise.all([
        getWebAuthnStatus(),
        getWebAuthnCredentials(),
      ]);
      setEnabled(status.enabled);
      setCredentials(creds);
    } catch {
      // Silently fail on load
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    setBrowserSupported(browserSupportsWebAuthn());
    loadData();
  }, [loadData]);

  const handleStartRegistration = async () => {
    setError('');
    setRegistering(true);
    try {
      const options = await getWebAuthnRegistrationOptions();
      const credential = await startRegistration({ optionsJSON: options });
      setPendingCredential(credential);
      setPendingChallenge(options.challenge);
      setFriendlyName('');
      setNameDialogOpen(true);
    } catch (err: unknown) {
      if ((err as Error)?.name === 'NotAllowedError') {
        setError('Registration was cancelled or timed out.');
      } else {
        setError(extractApiError(err, 'Failed to start registration.'));
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleCompleteRegistration = async () => {
    if (!pendingCredential) return;
    setLoading(true);
    try {
      await registerWebAuthnCredential(pendingCredential, friendlyName || undefined, pendingChallenge || undefined);
      notify('Security key registered successfully.', 'success');
      setNameDialogOpen(false);
      setPendingCredential(null);
      setPendingChallenge(null);
      await loadData();
    } catch (err: unknown) {
      setError(extractApiError(err, 'Registration verification failed.'));
      setNameDialogOpen(false);
      setPendingChallenge(null);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    setError('');
    setLoading(true);
    try {
      await removeWebAuthnCredential(id);
      notify('Security key removed.', 'success');
      setDeleteConfirmId(null);
      await loadData();
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to remove credential.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    setError('');
    setLoading(true);
    try {
      await renameWebAuthnCredential(id, editName.trim());
      setEditingId(null);
      await loadData();
    } catch (err: unknown) {
      setError(extractApiError(err, 'Failed to rename credential.'));
    } finally {
      setLoading(false);
    }
  };

  if (statusLoading) return null;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <KeyIcon fontSize="small" />
          <Typography variant="h6">Passkeys & Security Keys</Typography>
          <Chip
            label={enabled ? 'Enabled' : 'Disabled'}
            color={enabled ? 'success' : 'default'}
            size="small"
          />
          {credentials.length > 0 && (
            <Chip label={`${credentials.length} key${credentials.length !== 1 ? 's' : ''}`} size="small" variant="outlined" />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Use passkeys or hardware security keys (YubiKey, Titan, etc.) for passwordless sign-in and phishing-resistant verification.
        </Typography>

        {!browserSupported && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Your browser does not support WebAuthn. Use a modern browser like Chrome, Firefox, Safari, or Edge.
          </Alert>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {/* Credential list */}
        {credentials.length > 0 && (
          <List dense sx={{ mb: 2 }}>
            {credentials.map((cred) => (
              <ListItem key={cred.id} divider>
                {editingId === cred.id ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
                    <TextField
                      size="small"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRename(cred.id); if (e.key === 'Escape') setEditingId(null); }}
                      slotProps={{ htmlInput: { maxLength: 64 } }}
                      autoFocus
                      sx={{ flex: 1 }}
                    />
                    <Button size="small" onClick={() => handleRename(cred.id)} disabled={loading || !editName.trim()}>Save</Button>
                    <Button size="small" onClick={() => setEditingId(null)}>Cancel</Button>
                  </Stack>
                ) : (
                  <>
                    <ListItemText
                      primary={cred.friendlyName}
                      secondary={
                        <>
                          {cred.deviceType && `${cred.deviceType} · `}
                          {`Added ${new Date(cred.createdAt).toLocaleDateString()}`}
                          {cred.lastUsedAt && ` · Last used ${new Date(cred.lastUsedAt).toLocaleDateString()}`}
                          {cred.backedUp && ' · Synced'}
                        </>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Rename">
                        <IconButton size="small" onClick={() => { setEditingId(cred.id); setEditName(cred.friendlyName); }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove">
                        <IconButton size="small" color="error" onClick={() => setDeleteConfirmId(cred.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </>
                )}
              </ListItem>
            ))}
          </List>
        )}

        {/* Register button */}
        {browserSupported && (
          <Button
            variant="contained"
            startIcon={registering ? <CircularProgress size={16} color="inherit" /> : <KeyIcon />}
            disabled={registering || loading}
            onClick={handleStartRegistration}
          >
            {registering ? 'Waiting for device...' : 'Add Security Key'}
          </Button>
        )}

        {/* Friendly name dialog */}
        <Dialog open={nameDialogOpen} onClose={() => { setNameDialogOpen(false); setPendingCredential(null); setPendingChallenge(null); }}>
          <DialogTitle>Name Your Security Key</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Give this key a name so you can identify it later.
            </Typography>
            <TextField
              fullWidth
              label="Key Name"
              value={friendlyName}
              onChange={(e) => setFriendlyName(e.target.value)}
              placeholder="e.g., YubiKey 5, MacBook Touch ID"
              size="small"
              slotProps={{ htmlInput: { maxLength: 64 } }}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleCompleteRegistration(); }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setNameDialogOpen(false); setPendingCredential(null); }}>Cancel</Button>
            <Button variant="contained" onClick={handleCompleteRegistration} disabled={loading}>
              {loading ? 'Saving...' : 'Save'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete confirmation dialog */}
        <Dialog open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)}>
          <DialogTitle>Remove Security Key?</DialogTitle>
          <DialogContent>
            <Typography>
              This security key will be removed from your account.
              {credentials.length === 1 && ' This is your last key — WebAuthn MFA will be disabled.'}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => deleteConfirmId && handleRemove(deleteConfirmId)}
              disabled={loading}
            >
              {loading ? 'Removing...' : 'Remove'}
            </Button>
          </DialogActions>
        </Dialog>
      </CardContent>
    </Card>
  );
}
