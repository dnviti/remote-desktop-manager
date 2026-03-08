import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  FormControl, InputLabel, Select, MenuItem, Box, Alert, List, ListItem,
  ListItemIcon, ListItemText, Typography,
  ToggleButton, ToggleButtonGroup, CircularProgress,
} from '@mui/material';
import {
  Computer as RdpIcon,
  Terminal as SshIcon,
} from '@mui/icons-material';
import { batchShareConnections, BatchShareResult } from '../../api/sharing.api';
import { useAuthStore } from '../../store/authStore';
import { useConnectionsStore } from '../../store/connectionsStore';
import { ConnectionData } from '../../api/connections.api';
import { UserSearchResult } from '../../api/user.api';
import { collectFolderConnections } from '../Sidebar/treeHelpers';
import UserPicker from '../UserPicker';

interface ShareFolderDialogProps {
  open: boolean;
  onClose: () => void;
  folderId: string;
  folderName: string;
}

export default function ShareFolderDialog({
  open,
  onClose,
  folderId,
  folderName,
}: ShareFolderDialogProps) {
  const hasTenant = !!useAuthStore((s) => s.user?.tenantId);
  const ownConnections = useConnectionsStore((s) => s.ownConnections);
  const folders = useConnectionsStore((s) => s.folders);

  const [email, setEmail] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [scope, setScope] = useState<'tenant' | 'team'>('tenant');
  const [permission, setPermission] = useState<'READ_ONLY' | 'FULL_ACCESS'>('READ_ONLY');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BatchShareResult | null>(null);

  // Collect owned connections in this folder (recursively)
  const folderConnections = useMemo(() => {
    if (!open) return [];
    const folderMap = new Map<string, ConnectionData[]>();
    ownConnections.forEach((c) => {
      if (c.folderId) {
        const list = folderMap.get(c.folderId) || [];
        list.push(c);
        folderMap.set(c.folderId, list);
      }
    });
    return collectFolderConnections(folderId, folderMap, folders, true)
      .filter((c) => c.isOwner);
  }, [open, folderId, ownConnections, folders]);

  useEffect(() => {
    if (open) {
      setSelectedUser(null);
      setEmail('');
      setError('');
      setResult(null);
    }
  }, [open, folderId]);

  const handleShare = async () => {
    setError('');
    if (hasTenant) {
      if (!selectedUser) {
        setError('Select a user to share with');
        return;
      }
    } else {
      if (!email) {
        setError('Email is required');
        return;
      }
    }

    if (folderConnections.length === 0) {
      setError('No owned connections found in this folder');
      return;
    }

    setLoading(true);
    try {
      const target = selectedUser
        ? { userId: selectedUser.id }
        : { email };
      const connectionIds = folderConnections.map((c) => c.id);
      const res = await batchShareConnections(connectionIds, target, permission, folderName);
      setResult(res);
      setSelectedUser(null);
      setEmail('');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to share connections';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Share Folder: {folderName}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {result && (
          <Alert severity={result.failed > 0 ? 'warning' : 'success'} sx={{ mb: 2 }}>
            {result.shared} of {result.shared + result.failed + result.alreadyShared} connection{result.shared + result.failed + result.alreadyShared !== 1 ? 's' : ''} shared successfully
            {result.alreadyShared > 0 && ` (${result.alreadyShared} already shared)`}
            {result.failed > 0 && ` (${result.failed} failed)`}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
          {folderConnections.length} connection{folderConnections.length !== 1 ? 's' : ''} will be shared (including subfolders)
        </Typography>

        <Box sx={{ maxHeight: 160, overflow: 'auto', mb: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
          <List dense disablePadding>
            {folderConnections.map((conn) => (
              <ListItem key={conn.id} sx={{ py: 0.25 }}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  {conn.type === 'RDP'
                    ? <RdpIcon fontSize="small" color="primary" />
                    : <SshIcon fontSize="small" color="secondary" />}
                </ListItemIcon>
                <ListItemText
                  primary={conn.name}
                  primaryTypographyProps={{ variant: 'body2', noWrap: true }}
                />
              </ListItem>
            ))}
            {folderConnections.length === 0 && (
              <ListItem>
                <ListItemText
                  primary="No owned connections in this folder"
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary' }}
                />
              </ListItem>
            )}
          </List>
        </Box>

        {hasTenant && (
          <ToggleButtonGroup
            value={scope}
            exclusive
            onChange={(_e, val) => { if (val) setScope(val); }}
            size="small"
            sx={{ mb: 1 }}
          >
            <ToggleButton value="tenant">Organization</ToggleButton>
            <ToggleButton value="team">My Team</ToggleButton>
          </ToggleButtonGroup>
        )}

        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          {hasTenant ? (
            <UserPicker
              onSelect={setSelectedUser}
              scope={scope}
              placeholder="Search users by name or email..."
            />
          ) : (
            <TextField
              label="User email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              size="small"
              fullWidth
            />
          )}
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Permission</InputLabel>
            <Select
              value={permission}
              label="Permission"
              onChange={(e) =>
                setPermission(e.target.value as 'READ_ONLY' | 'FULL_ACCESS')
              }
            >
              <MenuItem value="READ_ONLY">Read Only</MenuItem>
              <MenuItem value="FULL_ACCESS">Full Access</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={handleShare}
            disabled={loading || folderConnections.length === 0}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {loading ? <CircularProgress size={20} /> : 'Share'}
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
