import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Drawer, Box, Typography, IconButton, List, ListItem, ListItemIcon,
  ListItemText, ListItemSecondaryAction, Button, CircularProgress,
  Alert, Divider, Breadcrumbs, Link, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, DialogContentText,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  UploadFile as UploadIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Link as LinkIcon,
  CreateNewFolder as NewFolderIcon,
  Refresh as RefreshIcon,
  NavigateNext as NavNextIcon,
  Home as HomeIcon,
} from '@mui/icons-material';
import { useSftpTransfers, type SftpSocket } from '../../hooks/useSftpTransfers';
import SftpTransferQueue from './SftpTransferQueue';

interface SftpEntry {
  name: string;
  size: number;
  type: 'file' | 'directory' | 'symlink';
  modifiedAt: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 86400000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

interface SftpBrowserProps {
  open: boolean;
  onClose: () => void;
  socket: SftpSocket | null;
  disableDownload?: boolean;
  disableUpload?: boolean;
}

export default function SftpBrowser({ open, onClose, socket, disableDownload, disableUpload }: SftpBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);
  const [renameTarget, setRenameTarget] = useState<SftpEntry | null>(null);
  const [renameName, setRenameName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshedTransfers = useRef<Set<string>>(new Set());

  const { transfers, uploadFile, downloadFile, cancelTransfer, clearCompleted } = useSftpTransfers(socket);

  const fetchEntries = useCallback((dirPath: string) => {
    if (!socket?.connected) return;
    setLoading(true);
    setError('');
    socket.emit('sftp:list', { path: dirPath }, (res: { entries?: SftpEntry[]; error?: string }) => {
      setLoading(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      // Sort: directories first, then files, alphabetically
      const sorted = (res.entries || []).sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
    });
  }, [socket]);

  /* eslint-disable react-hooks/set-state-in-effect -- triggers data fetch when drawer opens or path changes */
  useEffect(() => {
    if (open) fetchEntries(currentPath);
  }, [open, currentPath, fetchEntries]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const navigateTo = (newPath: string) => {
    setCurrentPath(newPath);
  };

  const handleEntryDoubleClick = (entry: SftpEntry) => {
    if (entry.type === 'directory' || entry.type === 'symlink') {
      const newPath = currentPath === '/'
        ? '/' + entry.name
        : currentPath + '/' + entry.name;
      navigateTo(newPath);
    }
  };

  const handleUpload = (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      uploadFile(files[i], currentPath);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleUpload(e.target.files);
    e.target.value = '';
  };

  const handleDownload = (entry: SftpEntry) => {
    const fullPath = currentPath === '/' ? '/' + entry.name : currentPath + '/' + entry.name;
    downloadFile(fullPath);
  };

  const handleMkdir = () => {
    if (!socket?.connected || !mkdirName.trim()) return;
    const newPath = currentPath === '/'
      ? '/' + mkdirName.trim()
      : currentPath + '/' + mkdirName.trim();
    socket.emit('sftp:mkdir', { path: newPath }, (res: { error?: string }) => {
      if (res.error) {
        setError(res.error);
      } else {
        fetchEntries(currentPath);
      }
      setMkdirOpen(false);
      setMkdirName('');
    });
  };

  const handleDelete = () => {
    if (!socket?.connected || !deleteTarget) return;
    const fullPath = currentPath === '/'
      ? '/' + deleteTarget.name
      : currentPath + '/' + deleteTarget.name;
    const event = deleteTarget.type === 'directory' ? 'sftp:rmdir' : 'sftp:delete';
    socket.emit(event, { path: fullPath }, (res: { error?: string }) => {
      if (res.error) {
        setError(res.error);
      } else {
        fetchEntries(currentPath);
      }
      setDeleteTarget(null);
    });
  };

  const handleRename = () => {
    if (!socket?.connected || !renameTarget || !renameName.trim()) return;
    const oldPath = currentPath === '/'
      ? '/' + renameTarget.name
      : currentPath + '/' + renameTarget.name;
    const newPath = currentPath === '/'
      ? '/' + renameName.trim()
      : currentPath + '/' + renameName.trim();
    socket.emit('sftp:rename', { oldPath, newPath }, (res: { error?: string }) => {
      if (res.error) {
        setError(res.error);
      } else {
        fetchEntries(currentPath);
      }
      setRenameTarget(null);
      setRenameName('');
    });
  };

  // Refresh listing when an upload completes
  /* eslint-disable react-hooks/set-state-in-effect -- triggers refresh when upload completes */
  useEffect(() => {
    let shouldRefresh = false;
    for (const t of transfers) {
      if (t.status === 'complete' && t.direction === 'upload' && !refreshedTransfers.current.has(t.transferId)) {
        refreshedTransfers.current.add(t.transferId);
        // Check if the uploaded file is in the current directory
        const dir = t.remotePath.substring(0, t.remotePath.lastIndexOf('/')) || '/';
        if (dir === currentPath) {
          shouldRefresh = true;
        }
      }
    }
    if (shouldRefresh) {
      fetchEntries(currentPath);
    }
  }, [transfers, currentPath, fetchEntries]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // Build breadcrumb segments
  const pathSegments = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  const entryIcon = (type: SftpEntry['type']) => {
    switch (type) {
      case 'directory': return <FolderIcon fontSize="small" color="primary" />;
      case 'symlink': return <LinkIcon fontSize="small" color="secondary" />;
      default: return <FileIcon fontSize="small" />;
    }
  };

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        variant="persistent"
        sx={{ '& .MuiDrawer-paper': { width: 360, position: 'absolute' } }}
      >
        <Box
          sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
          onDragOver={disableUpload ? undefined : handleDragOver}
          onDragLeave={disableUpload ? undefined : handleDragLeave}
          onDrop={disableUpload ? undefined : handleDrop}
        >
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, pl: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>SFTP</Typography>
            <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
          </Box>

          <Divider />

          {/* Breadcrumb */}
          <Box sx={{ px: 1.5, py: 1, overflow: 'auto' }}>
            <Breadcrumbs separator={<NavNextIcon fontSize="small" />} sx={{ fontSize: '0.8rem' }}>
              <Link
                component="button"
                underline="hover"
                onClick={() => navigateTo('/')}
                sx={{ display: 'flex', alignItems: 'center', fontSize: '0.8rem' }}
              >
                <HomeIcon sx={{ fontSize: 16, mr: 0.25 }} />
              </Link>
              {pathSegments.map((segment, idx) => {
                const segPath = '/' + pathSegments.slice(0, idx + 1).join('/');
                const isLast = idx === pathSegments.length - 1;
                return isLast ? (
                  <Typography key={segPath} color="text.primary" sx={{ fontSize: '0.8rem' }}>
                    {segment}
                  </Typography>
                ) : (
                  <Link
                    key={segPath}
                    component="button"
                    underline="hover"
                    onClick={() => navigateTo(segPath)}
                    sx={{ fontSize: '0.8rem' }}
                  >
                    {segment}
                  </Link>
                );
              })}
            </Breadcrumbs>
          </Box>

          <Divider />

          {/* Action bar */}
          <Box sx={{ display: 'flex', gap: 0.5, p: 1, px: 1.5 }}>
            {!disableUpload && (
              <>
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<UploadIcon />}
                  onClick={() => fileInputRef.current?.click()}
                  sx={{ flex: 1, fontSize: '0.75rem' }}
                >
                  Upload
                </Button>
              </>
            )}
            <Button
              variant="outlined"
              size="small"
              startIcon={<NewFolderIcon />}
              onClick={() => setMkdirOpen(true)}
              sx={{ flex: 1, fontSize: '0.75rem' }}
            >
              New Folder
            </Button>
            <IconButton size="small" onClick={() => fetchEntries(currentPath)} disabled={loading}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* Drag overlay */}
          {dragOver && !disableUpload && (
            <Box sx={{
              mx: 1.5, p: 2, border: '2px dashed', borderColor: 'primary.main',
              borderRadius: 1, textAlign: 'center', bgcolor: 'action.hover',
            }}>
              <Typography variant="body2" color="primary">Drop files here to upload</Typography>
            </Box>
          )}

          {/* Error */}
          {error && (
            <Alert severity="error" sx={{ mx: 1.5, mb: 1 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {/* File list */}
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                <CircularProgress size={24} />
              </Box>
            ) : entries.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                This directory is empty
              </Typography>
            ) : (
              <List dense>
                {entries.map((entry) => (
                  <ListItem
                    key={entry.name}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    sx={{
                      cursor: entry.type === 'directory' || entry.type === 'symlink' ? 'pointer' : 'default',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {entryIcon(entry.type)}
                    </ListItemIcon>
                    <ListItemText
                      primary={entry.name}
                      secondary={
                        entry.type === 'directory'
                          ? formatDate(entry.modifiedAt)
                          : `${formatFileSize(entry.size)} - ${formatDate(entry.modifiedAt)}`
                      }
                      primaryTypographyProps={{ noWrap: true, fontSize: '0.85rem' }}
                      secondaryTypographyProps={{ fontSize: '0.7rem' }}
                    />
                    <ListItemSecondaryAction>
                      {entry.type === 'file' && !disableDownload && (
                        <IconButton size="small" onClick={() => handleDownload(entry)} title="Download">
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => {
                          setRenameTarget(entry);
                          setRenameName(entry.name);
                        }}
                        title="Rename"
                        sx={{ fontSize: '0.7rem', px: 0.5 }}
                      >
                        <Typography variant="caption">Aa</Typography>
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => setDeleteTarget(entry)}
                        title="Delete"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </Box>

          {/* Transfer Queue */}
          <SftpTransferQueue
            transfers={transfers}
            onCancel={cancelTransfer}
            onClearCompleted={clearCompleted}
          />
        </Box>
      </Drawer>

      {/* New Folder Dialog */}
      <Dialog open={mkdirOpen} onClose={() => setMkdirOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>New Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Folder name"
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleMkdir(); }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMkdirOpen(false)}>Cancel</Button>
          <Button onClick={handleMkdir} variant="contained" disabled={!mkdirName.trim()}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs">
        <DialogTitle>Delete {deleteTarget?.type === 'directory' ? 'Folder' : 'File'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete "{deleteTarget?.name}"?
            {deleteTarget?.type === 'directory' && ' The directory must be empty.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={!!renameTarget} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Rename</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="New name"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameTarget(null)}>Cancel</Button>
          <Button onClick={handleRename} variant="contained" disabled={!renameName.trim() || renameName === renameTarget?.name}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
