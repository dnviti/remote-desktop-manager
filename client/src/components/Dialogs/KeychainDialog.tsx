import { useState, useEffect, forwardRef } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, IconButton, Box,
  Alert, Button,
  DialogTitle, DialogContent, DialogContentText, DialogActions,
  Slide,
} from '@mui/material';
import type { TransitionProps } from '@mui/material/transitions';
import { Close as CloseIcon } from '@mui/icons-material';
import SecretListPanel from '../Keychain/SecretListPanel';
import SecretDetailView from '../Keychain/SecretDetailView';
import SecretDialog from '../Keychain/SecretDialog';
import ShareSecretDialog from '../Keychain/ShareSecretDialog';
import ExternalShareDialog from '../Keychain/ExternalShareDialog';
import { useSecretStore } from '../../store/secretStore';
import { useAuthStore } from '../../store/authStore';
import type { SecretListItem, SecretDetail } from '../../api/secrets.api';
import { getSecret } from '../../api/secrets.api';

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

interface KeychainDialogProps {
  open: boolean;
  onClose: () => void;
}

const LIST_PANEL_WIDTH = 320;

export default function KeychainDialog({ open, onClose }: KeychainDialogProps) {
  const selectedSecret = useSecretStore((s) => s.selectedSecret);
  const fetchSecret = useSecretStore((s) => s.fetchSecret);
  const deleteSecretAction = useSecretStore((s) => s.deleteSecret);
  const toggleFavorite = useSecretStore((s) => s.toggleFavorite);
  const tenantVaultStatus = useSecretStore((s) => s.tenantVaultStatus);
  const fetchTenantVaultStatus = useSecretStore((s) => s.fetchTenantVaultStatus);
  const initTenantVault = useSecretStore((s) => s.initTenantVault);
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.tenantRole === 'OWNER' || user?.tenantRole === 'ADMIN';
  const hasTenant = !!user?.tenantId;

  const [initializingVault, setInitializingVault] = useState(false);

  useEffect(() => {
    if (open && hasTenant) fetchTenantVaultStatus();
  }, [open, hasTenant, fetchTenantVaultStatus]);

  const handleInitTenantVault = async () => {
    setInitializingVault(true);
    try {
      await initTenantVault();
    } catch {
      // error handled by store
    } finally {
      setInitializingVault(false);
    }
  };

  // Dialog state
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretDetail | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; name: string; teamId?: string | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SecretListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [externalShareTarget, setExternalShareTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreateSecret = () => {
    setEditingSecret(null);
    setSecretDialogOpen(true);
  };

  const handleEditSecret = async (secret: SecretListItem) => {
    try {
      const detail = await getSecret(secret.id);
      setEditingSecret(detail);
      setSecretDialogOpen(true);
    } catch {
      // If fetch fails (e.g., vault locked), still open with null
      setEditingSecret(null);
      setSecretDialogOpen(true);
    }
  };

  const handleShareSecret = (secret: SecretListItem) => {
    setShareTarget({ id: secret.id, name: secret.name, teamId: secret.teamId });
  };

  const handleDeleteSecret = (secret: SecretListItem) => {
    setDeleteTarget(secret);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSecretAction(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
    }
  };

  const handleRestore = () => {
    if (selectedSecret) {
      fetchSecret(selectedSecret.id);
    }
  };

  return (
    <Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>
      <AppBar position="static" sx={{ position: 'relative' }}>
        <Toolbar variant="dense">
          <IconButton edge="start" color="inherit" onClick={onClose} sx={{ mr: 1 }}>
            <CloseIcon />
          </IconButton>
          <Typography variant="h6">
            Keychain
          </Typography>
        </Toolbar>
      </AppBar>

      {/* Tenant vault banner */}
      {hasTenant && tenantVaultStatus && !tenantVaultStatus.initialized && isAdmin && (
        <Alert
          severity="info"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={handleInitTenantVault}
              disabled={initializingVault}
            >
              {initializingVault ? 'Initializing...' : 'Initialize Now'}
            </Button>
          }
          sx={{ borderRadius: 0 }}
        >
          Organization vault is not initialized. Initialize it to create and share organization-scoped secrets.
        </Alert>
      )}
      {hasTenant && tenantVaultStatus && tenantVaultStatus.initialized && !tenantVaultStatus.hasAccess && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          You don&apos;t have access to the organization vault yet. Ask an admin to distribute the key to you.
        </Alert>
      )}

      {/* Main content */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left panel */}
        <Box
          sx={{
            width: LIST_PANEL_WIDTH,
            minWidth: LIST_PANEL_WIDTH,
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <SecretListPanel
            onCreateSecret={handleCreateSecret}
            onEditSecret={handleEditSecret}
            onShareSecret={handleShareSecret}
            onDeleteSecret={handleDeleteSecret}
          />
        </Box>

        {/* Right panel */}
        <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'background.default' }}>
          {selectedSecret ? (
            <SecretDetailView
              secret={selectedSecret}
              onEdit={() => {
                setEditingSecret(selectedSecret);
                setSecretDialogOpen(true);
              }}
              onShare={() => setShareTarget({ id: selectedSecret.id, name: selectedSecret.name, teamId: selectedSecret.teamId })}
              onExternalShare={() => setExternalShareTarget({ id: selectedSecret.id, name: selectedSecret.name })}
              onDelete={() => setDeleteTarget(selectedSecret)}
              onToggleFavorite={() => toggleFavorite(selectedSecret.id)}
              onRestore={handleRestore}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Typography variant="body1" color="text.secondary">
                Select a secret to view its details
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Dialogs */}
      <SecretDialog
        open={secretDialogOpen}
        onClose={() => { setSecretDialogOpen(false); setEditingSecret(null); }}
        secret={editingSecret}
      />

      <ShareSecretDialog
        open={!!shareTarget}
        onClose={() => setShareTarget(null)}
        secretId={shareTarget?.id ?? ''}
        secretName={shareTarget?.name ?? ''}
        teamId={shareTarget?.teamId}
      />

      <ExternalShareDialog
        open={!!externalShareTarget}
        onClose={() => setExternalShareTarget(null)}
        secretId={externalShareTarget?.id ?? ''}
        secretName={externalShareTarget?.name ?? ''}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Secret</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={confirmDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
