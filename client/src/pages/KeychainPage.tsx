import { useState, useEffect } from 'react';
import {
  Box, AppBar, Toolbar, Typography, IconButton, Chip, Alert, Button as MuiButton,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
} from '@mui/material';
import {
  ArrowBack,
  Lock as LockIcon,
  LockOpen as LockOpenIcon,
  DarkMode,
  LightMode,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import SecretListPanel from '../components/Keychain/SecretListPanel';
import SecretDetailView from '../components/Keychain/SecretDetailView';
import SecretDialog from '../components/Keychain/SecretDialog';
import ShareSecretDialog from '../components/Keychain/ShareSecretDialog';
import { useSecretStore } from '../store/secretStore';
import { useVaultStore } from '../store/vaultStore';
import { useThemeStore } from '../store/themeStore';
import { useAuthStore } from '../store/authStore';
import type { SecretListItem, SecretDetail } from '../api/secrets.api';
import { getSecret } from '../api/secrets.api';

const LIST_PANEL_WIDTH = 320;

export default function KeychainPage() {
  const navigate = useNavigate();
  const selectedSecret = useSecretStore((s) => s.selectedSecret);
  const fetchSecret = useSecretStore((s) => s.fetchSecret);
  const deleteSecretAction = useSecretStore((s) => s.deleteSecret);
  const toggleFavorite = useSecretStore((s) => s.toggleFavorite);
  const tenantVaultStatus = useSecretStore((s) => s.tenantVaultStatus);
  const fetchTenantVaultStatus = useSecretStore((s) => s.fetchTenantVaultStatus);
  const initTenantVault = useSecretStore((s) => s.initTenantVault);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const themeMode = useThemeStore((s) => s.mode);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const user = useAuthStore((s) => s.user);

  const isAdmin = user?.tenantRole === 'OWNER' || user?.tenantRole === 'ADMIN';
  const hasTenant = !!user?.tenantId;

  const [initializingVault, setInitializingVault] = useState(false);

  useEffect(() => {
    if (hasTenant) fetchTenantVaultStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, [hasTenant]);

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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* AppBar */}
      <AppBar position="static" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        <Toolbar variant="dense">
          <IconButton color="inherit" edge="start" onClick={() => navigate('/')} sx={{ mr: 1 }}>
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" sx={{ flexGrow: 0, mr: 2 }}>
            RDM
          </Typography>
          <Chip
            icon={vaultUnlocked ? <LockOpenIcon /> : <LockIcon />}
            label={vaultUnlocked ? 'Vault Unlocked' : 'Vault Locked'}
            color={vaultUnlocked ? 'success' : 'error'}
            size="small"
            sx={{ mr: 2 }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <IconButton
            color="inherit"
            onClick={toggleTheme}
            title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {themeMode === 'dark' ? <LightMode /> : <DarkMode />}
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Tenant vault banner */}
      {hasTenant && tenantVaultStatus && !tenantVaultStatus.initialized && isAdmin && (
        <Alert
          severity="info"
          action={
            <MuiButton
              color="inherit"
              size="small"
              onClick={handleInitTenantVault}
              disabled={initializingVault}
            >
              {initializingVault ? 'Initializing...' : 'Initialize Now'}
            </MuiButton>
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
    </Box>
  );
}
