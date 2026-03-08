import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Drawer, Box, Typography, IconButton, List, ListItem, ListItemIcon,
  ListItemText, ListItemSecondaryAction, Button, CircularProgress,
  Alert, Divider,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  Delete as DeleteIcon,
  UploadFile as UploadIcon,
  InsertDriveFile as FileIcon,
} from '@mui/icons-material';
import { listFiles, uploadFile, downloadFile, deleteFile, FileInfo } from '../../api/files.api';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileBrowserProps {
  open: boolean;
  onClose: () => void;
}

export default function FileBrowser({ open, onClose }: FileBrowserProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listFiles();
      setFiles(result);
    } catch {
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchFiles();
  }, [open, fetchFiles]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const result = await uploadFile(file);
      setFiles(result);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to upload file';
      setError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  };

  const handleDownload = async (name: string) => {
    try {
      await downloadFile(name);
    } catch {
      setError('Failed to download file');
    }
  };

  const handleDelete = async (name: string) => {
    setError('');
    try {
      await deleteFile(name);
      setFiles((prev) => prev.filter((f) => f.name !== name));
    } catch {
      setError('Failed to delete file');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="persistent"
      sx={{
        '& .MuiDrawer-paper': {
          width: 320,
          position: 'absolute',
        },
      }}
    >
      <Box
        sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1.5, pl: 2 }}>
          <Typography variant="subtitle1" fontWeight={600}>Shared Drive</Typography>
          <IconButton size="small" onClick={onClose}><CloseIcon /></IconButton>
        </Box>

        <Divider />

        <Box sx={{ p: 1.5 }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <Button
            variant="outlined"
            startIcon={uploading ? <CircularProgress size={16} /> : <UploadIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            fullWidth
            size="small"
          >
            {uploading ? 'Uploading...' : 'Upload File'}
          </Button>
        </Box>

        {dragOver && (
          <Box sx={{
            mx: 1.5, p: 2, border: '2px dashed', borderColor: 'primary.main',
            borderRadius: 1, textAlign: 'center', bgcolor: 'action.hover',
          }}>
            <Typography variant="body2" color="primary">Drop file here</Typography>
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mx: 1.5, mb: 1 }} onClose={() => setError('')}>{error}</Alert>}

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : files.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
              No files yet. Upload a file or copy files to the Shared drive from inside the RDP session.
            </Typography>
          ) : (
            <List dense>
              {files.map((file) => (
                <ListItem key={file.name}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FileIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={file.name}
                    secondary={`${formatFileSize(file.size)} - ${new Date(file.modifiedAt).toLocaleDateString()}`}
                    primaryTypographyProps={{ noWrap: true, fontSize: '0.85rem' }}
                    secondaryTypographyProps={{ fontSize: '0.75rem' }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton size="small" onClick={() => handleDownload(file.name)} title="Download">
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(file.name)} title="Delete">
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        <Divider />
        <Box sx={{ p: 1, textAlign: 'center' }}>
          <Button size="small" onClick={fetchFiles} disabled={loading}>
            Refresh
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}
