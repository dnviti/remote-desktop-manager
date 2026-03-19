import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box, Typography, TextField, FormControl, InputLabel, Select, MenuItem,
  List, ListItemButton, ListItemIcon, ListItemText, Chip, IconButton,
  Menu, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
} from '@mui/material';
import {
  VpnKey, Key, VerifiedUser, Api, Notes,
  Add as AddIcon, Search as SearchIcon,
  Star, StarBorder,
  Edit as EditIcon, Share as ShareIcon, Delete as DeleteIcon,
  ContentCopy as CopyIcon,
  DriveFileMove as MoveIcon,
  GppBad as BreachIcon,
} from '@mui/icons-material';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useSecretStore } from '../../store/secretStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import type { SecretListItem, SecretType, SecretScope } from '../../api/secrets.api';
import type { VaultFolderData } from '../../api/vault-folders.api';

const TYPE_ICONS: Record<SecretType, React.ReactNode> = {
  LOGIN: <VpnKey fontSize="small" />,
  SSH_KEY: <Key fontSize="small" />,
  CERTIFICATE: <VerifiedUser fontSize="small" />,
  API_KEY: <Api fontSize="small" />,
  SECURE_NOTE: <Notes fontSize="small" />,
};

const TYPE_LABELS: Record<SecretType, string> = {
  LOGIN: 'Login',
  SSH_KEY: 'SSH Key',
  CERTIFICATE: 'Certificate',
  API_KEY: 'API Key',
  SECURE_NOTE: 'Secure Note',
};

const SCOPE_COLORS: Record<SecretScope, 'default' | 'primary' | 'secondary'> = {
  PERSONAL: 'default',
  TEAM: 'primary',
  TENANT: 'secondary',
};

// --- Draggable secret item ---

function DraggableSecretItem({
  secret,
  isSelected,
  daysUntilExpiry,
  onSelect,
  onContextMenu,
  onToggleFavorite,
}: {
  secret: SecretListItem;
  isSelected: boolean;
  daysUntilExpiry: number | null;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onToggleFavorite: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `secret-${secret.id}`,
    data: { type: 'secret', secret },
  });

  return (
    <ListItemButton
      ref={setNodeRef}
      selected={isSelected}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      sx={{
        px: 1.5,
        cursor: 'grab',
        ...(isDragging && { opacity: 0.4 }),
        ...(transform && { transform: CSS.Translate.toString(transform) }),
      }}
      {...listeners}
      {...attributes}
    >
      <ListItemIcon sx={{ minWidth: 32 }}>
        {TYPE_ICONS[secret.type]}
      </ListItemIcon>
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" noWrap sx={{ flex: 1 }}>
              {secret.name}
            </Typography>
            <Chip
              label={secret.scope === 'PERSONAL' ? 'Me' : secret.scope === 'TEAM' ? 'Team' : 'Org'}
              size="small"
              color={SCOPE_COLORS[secret.scope]}
              sx={{ height: 18, fontSize: '0.65rem' }}
            />
          </Box>
        }
        secondary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {TYPE_LABELS[secret.type]}
            </Typography>
            {secret.pwnedCount > 0 && (
              <Chip
                icon={<BreachIcon sx={{ fontSize: '0.7rem' }} />}
                label="Breached"
                size="small"
                color="error"
                sx={{ height: 16, fontSize: '0.6rem' }}
              />
            )}
            {daysUntilExpiry !== null && daysUntilExpiry <= 30 && (
              <Chip
                label={daysUntilExpiry <= 0 ? 'Expired' : `${daysUntilExpiry}d left`}
                size="small"
                color={daysUntilExpiry <= 7 ? 'error' : 'warning'}
                sx={{ height: 16, fontSize: '0.6rem' }}
              />
            )}
          </Box>
        }
      />
      <IconButton
        size="small"
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        sx={{ ml: 0.5 }}
      >
        {secret.isFavorite ? <Star fontSize="small" color="warning" /> : <StarBorder fontSize="small" />}
      </IconButton>
    </ListItemButton>
  );
}

// --- Main panel ---

interface SecretListPanelProps {
  onCreateSecret: () => void;
  onEditSecret: (secret: SecretListItem) => void;
  onShareSecret: (secret: SecretListItem) => void;
  onDeleteSecret: (secret: SecretListItem) => void;
}

export default function SecretListPanel({
  onCreateSecret,
  onEditSecret,
  onShareSecret,
  onDeleteSecret,
}: SecretListPanelProps) {
  const secrets = useSecretStore((s) => s.secrets);
  const selectedSecret = useSecretStore((s) => s.selectedSecret);
  const fetchSecret = useSecretStore((s) => s.fetchSecret);
  const fetchSecrets = useSecretStore((s) => s.fetchSecrets);
  const toggleFavorite = useSecretStore((s) => s.toggleFavorite);
  const setFilters = useSecretStore((s) => s.setFilters);
  const selectedFolderId = useSecretStore((s) => s.selectedFolderId);
  const moveSecret = useSecretStore((s) => s.moveSecret);
  const vaultFolders = useSecretStore((s) => s.vaultFolders);
  const vaultTeamFolders = useSecretStore((s) => s.vaultTeamFolders);
  const vaultTenantFolders = useSecretStore((s) => s.vaultTenantFolders);

  const scopeFilter = useUiPreferencesStore((s) => s.keychainScopeFilter);
  const typeFilter = useUiPreferencesStore((s) => s.keychainTypeFilter);
  const setPref = useUiPreferencesStore((s) => s.set);

  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable time reference for expiry calculations (avoids Date.now() in render)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- secrets used intentionally to refresh timestamp when list changes
  const now = useMemo(() => new Date().getTime(), [secrets.length]);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    secret: SecretListItem;
  } | null>(null);

  // Move to folder dialog
  const [moveTarget, setMoveTarget] = useState<SecretListItem | null>(null);
  const [moveDestination, setMoveDestination] = useState('');

  const allFolders = useMemo<VaultFolderData[]>(() => [
    ...vaultFolders,
    ...vaultTeamFolders,
    ...vaultTenantFolders,
  ], [vaultFolders, vaultTeamFolders, vaultTenantFolders]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setFilters({ search: search || undefined });
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, setFilters]);

  const handleScopeChange = (value: string) => {
    setPref('keychainScopeFilter', value);
    setFilters({ scope: value === 'ALL' ? undefined : value as SecretScope });
  };

  const handleTypeChange = (value: string) => {
    setPref('keychainTypeFilter', value);
    setFilters({ type: value === 'ALL' ? undefined : value as SecretType });
  };

  const handleContextMenu = (e: React.MouseEvent, secret: SecretListItem) => {
    e.preventDefault();
    setContextMenu({ mouseX: e.clientX, mouseY: e.clientY, secret });
  };

  const getDaysUntilExpiry = useCallback((expiresAt: string): number => {
    const diff = new Date(expiresAt).getTime() - now;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }, [now]);

  const handleMoveToFolder = (secret: SecretListItem) => {
    setMoveTarget(secret);
    setMoveDestination(secret.folderId || '');
  };

  const handleConfirmMove = async () => {
    if (!moveTarget) return;
    const newFolderId = moveDestination || null;
    if (newFolderId === (moveTarget.folderId ?? null)) {
      setMoveTarget(null);
      return;
    }
    await moveSecret(moveTarget.id, newFolderId);
    setMoveTarget(null);
  };

  // Current folder name for breadcrumb
  const currentFolderName = useMemo(() => {
    if (!selectedFolderId) return null;
    const folder = allFolders.find((f) => f.id === selectedFolderId);
    return folder?.name ?? null;
  }, [selectedFolderId, allFolders]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, overflow: 'hidden' }}>
          <Typography variant="h6" sx={{ fontSize: '1.1rem' }} noWrap>
            {currentFolderName ? currentFolderName : 'Secrets'}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onCreateSecret} title="New Secret">
          <AddIcon />
        </IconButton>
      </Box>

      {/* Search */}
      <Box sx={{ px: 1.5, pb: 1 }}>
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search secrets..."
          size="small"
          fullWidth
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, px: 1.5, pb: 1 }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel>Scope</InputLabel>
          <Select value={scopeFilter} label="Scope" onChange={(e) => handleScopeChange(e.target.value)}>
            <MenuItem value="ALL">All</MenuItem>
            <MenuItem value="PERSONAL">Personal</MenuItem>
            <MenuItem value="TEAM">Team</MenuItem>
            <MenuItem value="TENANT">Organization</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel>Type</InputLabel>
          <Select value={typeFilter} label="Type" onChange={(e) => handleTypeChange(e.target.value)}>
            <MenuItem value="ALL">All</MenuItem>
            <MenuItem value="LOGIN">Login</MenuItem>
            <MenuItem value="SSH_KEY">SSH Key</MenuItem>
            <MenuItem value="CERTIFICATE">Certificate</MenuItem>
            <MenuItem value="API_KEY">API Key</MenuItem>
            <MenuItem value="SECURE_NOTE">Secure Note</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Secret list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {secrets.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 4 }}>
            No secrets found
          </Typography>
        ) : (
          <List dense disablePadding>
            {secrets.map((secret) => {
              const daysUntilExpiry = secret.expiresAt ? getDaysUntilExpiry(secret.expiresAt) : null;
              return (
                <DraggableSecretItem
                  key={secret.id}
                  secret={secret}
                  isSelected={selectedSecret?.id === secret.id}
                  daysUntilExpiry={daysUntilExpiry}
                  onSelect={() => fetchSecret(secret.id)}
                  onContextMenu={(e) => handleContextMenu(e, secret)}
                  onToggleFavorite={() => toggleFavorite(secret.id)}
                />
              );
            })}
          </List>
        )}
      </Box>

      {/* Context menu */}
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={() => { if (contextMenu) { onEditSecret(contextMenu.secret); } setContextMenu(null); }}>
          <EditIcon fontSize="small" sx={{ mr: 1 }} /> Edit
        </MenuItem>
        <MenuItem onClick={() => { if (contextMenu) { onShareSecret(contextMenu.secret); } setContextMenu(null); }}>
          <ShareIcon fontSize="small" sx={{ mr: 1 }} /> Share
        </MenuItem>
        <MenuItem onClick={() => { if (contextMenu) { handleMoveToFolder(contextMenu.secret); } setContextMenu(null); }}>
          <MoveIcon fontSize="small" sx={{ mr: 1 }} /> Move to Folder
        </MenuItem>
        <MenuItem onClick={() => { if (contextMenu) { toggleFavorite(contextMenu.secret.id); } setContextMenu(null); }}>
          <StarBorder fontSize="small" sx={{ mr: 1 }} /> Toggle Favorite
        </MenuItem>
        <MenuItem onClick={() => { if (contextMenu) { navigator.clipboard.writeText(contextMenu.secret.name); } setContextMenu(null); }}>
          <CopyIcon fontSize="small" sx={{ mr: 1 }} /> Copy Name
        </MenuItem>
        <MenuItem onClick={() => { if (contextMenu) { onDeleteSecret(contextMenu.secret); } setContextMenu(null); }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} color="error" /> Delete
        </MenuItem>
      </Menu>

      {/* Move to Folder dialog */}
      <Dialog open={!!moveTarget} onClose={() => setMoveTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Move &quot;{moveTarget?.name}&quot;</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Destination Folder</InputLabel>
            <Select
              value={moveDestination}
              label="Destination Folder"
              onChange={(e) => setMoveDestination(e.target.value)}
            >
              <MenuItem value="">Root (no folder)</MenuItem>
              {allFolders.map((f) => (
                <MenuItem key={f.id} value={f.id}>{f.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveTarget(null)}>Cancel</Button>
          <Button onClick={handleConfirmMove} variant="contained">Move</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
