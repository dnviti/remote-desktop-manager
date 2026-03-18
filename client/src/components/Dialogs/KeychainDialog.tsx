import { useState, useEffect } from 'react';
import {
  Dialog, AppBar, Toolbar, Typography, IconButton, Box,
  Alert, Button,
  DialogTitle, DialogContent, DialogContentText, DialogActions,
} from '@mui/material';
import {
  Close as CloseIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useSensor,
  useSensors,
  PointerSensor,
} from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import SecretTree from '../Keychain/SecretTree';
import SecretListPanel from '../Keychain/SecretListPanel';
import SecretDetailView from '../Keychain/SecretDetailView';
import SecretDialog from '../Keychain/SecretDialog';
import ShareSecretDialog from '../Keychain/ShareSecretDialog';
import ExternalShareDialog from '../Keychain/ExternalShareDialog';
import VaultFolderDialog from '../Keychain/VaultFolderDialog';
import { useSecretStore } from '../../store/secretStore';
import { useAuthStore } from '../../store/authStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import type { SecretListItem, SecretDetail } from '../../api/secrets.api';
import type { VaultFolderData, VaultFolderScope } from '../../api/vault-folders.api';
import { getSecret } from '../../api/secrets.api';
import { SlideUp } from '../common/SlideUp';
import { isAdminOrAbove } from '../../utils/roles';

interface KeychainDialogProps {
  open: boolean;
  onClose: () => void;
}

const TREE_PANEL_WIDTH = 200;
const LIST_PANEL_WIDTH = 320;

export default function KeychainDialog({ open, onClose }: KeychainDialogProps) {
  const selectedSecret = useSecretStore((s) => s.selectedSecret);
  const fetchSecret = useSecretStore((s) => s.fetchSecret);
  const deleteSecretAction = useSecretStore((s) => s.deleteSecret);
  const toggleFavorite = useSecretStore((s) => s.toggleFavorite);
  const tenantVaultStatus = useSecretStore((s) => s.tenantVaultStatus);
  const fetchTenantVaultStatus = useSecretStore((s) => s.fetchTenantVaultStatus);
  const initTenantVault = useSecretStore((s) => s.initTenantVault);
  const checkSecretBreach = useSecretStore((s) => s.checkSecretBreach);
  const user = useAuthStore((s) => s.user);

  const treeOpen = useUiPreferencesStore((s) => s.keychainTreeOpen);
  const togglePref = useUiPreferencesStore((s) => s.toggle);

  const moveSecret = useSecretStore((s) => s.moveSecret);

  const isAdmin = isAdminOrAbove(user?.tenantRole);
  const hasTenant = !!user?.tenantId;

  const [initializingVault, setInitializingVault] = useState(false);
  const [activeSecretDrag, setActiveSecretDrag] = useState<SecretListItem | null>(null);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const secret = event.active.data.current?.secret as SecretListItem | undefined;
    if (secret) setActiveSecretDrag(secret);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveSecretDrag(null);
    const { active, over } = event;
    if (!over) return;

    const secret = active.data.current?.secret as SecretListItem | undefined;
    if (!secret) return;

    const targetFolderId = (over.data.current?.folderId as string | null) ?? null;
    if (targetFolderId === (secret.folderId ?? null)) return;

    await moveSecret(secret.id, targetFolderId);
  };

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

  // Folder dialog state
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<VaultFolderData | null>(null);
  const [folderDialogScope, setFolderDialogScope] = useState<VaultFolderScope>('PERSONAL');
  const [folderDialogParentId, setFolderDialogParentId] = useState<string | null>(null);
  const [folderDialogTeamId, setFolderDialogTeamId] = useState<string | null>(null);

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

  const handleCreateFolder = (scope: VaultFolderScope, parentId?: string, teamId?: string) => {
    setEditingFolder(null);
    setFolderDialogScope(scope);
    setFolderDialogParentId(parentId || null);
    setFolderDialogTeamId(teamId || null);
    setFolderDialogOpen(true);
  };

  const handleEditFolder = (folder: VaultFolderData) => {
    setEditingFolder(folder);
    setFolderDialogScope(folder.scope);
    setFolderDialogTeamId(folder.teamId);
    setFolderDialogOpen(true);
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

      {/* Main content — 3-column layout with DnD */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Folder tree panel */}
        {treeOpen && (
          <Box
            sx={{
              width: TREE_PANEL_WIDTH,
              minWidth: TREE_PANEL_WIDTH,
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <SecretTree
              onCreateFolder={handleCreateFolder}
              onEditFolder={handleEditFolder}
            />
          </Box>
        )}

        {/* Tree toggle */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            borderRight: 1,
            borderColor: 'divider',
          }}
        >
          <IconButton
            size="small"
            onClick={() => togglePref('keychainTreeOpen')}
            title={treeOpen ? 'Hide folders' : 'Show folders'}
            sx={{ borderRadius: 0, width: 20, height: '100%' }}
          >
            {treeOpen ? <ChevronLeftIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Box>

        {/* Secret list panel */}
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

        {/* Detail panel */}
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
              onCheckBreach={checkSecretBreach}
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

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeSecretDrag && (
          <Box sx={{
            bgcolor: 'background.paper',
            boxShadow: 3,
            borderRadius: 1,
            px: 2,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            opacity: 0.9,
            pointerEvents: 'none',
            maxWidth: 220,
          }}>
            <Typography variant="body2" noWrap>{activeSecretDrag.name}</Typography>
          </Box>
        )}
      </DragOverlay>
      </DndContext>

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

      <VaultFolderDialog
        open={folderDialogOpen}
        onClose={() => { setFolderDialogOpen(false); setEditingFolder(null); }}
        folder={editingFolder}
        parentId={folderDialogParentId}
        scope={folderDialogScope}
        teamId={folderDialogTeamId}
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
