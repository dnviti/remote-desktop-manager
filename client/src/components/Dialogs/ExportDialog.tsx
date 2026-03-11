import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  Alert,
  FormControlLabel,
  Checkbox,
  CircularProgress,
} from '@mui/material';
import { CloudDownload as DownloadIcon } from '@mui/icons-material';
import { downloadExport } from '../../api/importExport.api';
import { getVaultStatus } from '../../api/vault.api';
import { useAsyncAction } from '../../hooks/useAsyncAction';

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  folderId?: string;
  connectionIds?: string[];
}

export default function ExportDialog({ open, onClose, folderId, connectionIds }: ExportDialogProps) {
  const [format, setFormat] = useState<'CSV' | 'JSON'>('JSON');
  const [includeCredentials, setIncludeCredentials] = useState(false);
  const { loading, error, clearError, run } = useAsyncAction();
  const [vaultUnlocked, setVaultUnlocked] = useState(false);

  useEffect(() => {
    if (open) {
      checkVaultStatus();
      setIncludeCredentials(false);
      clearError();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clearError is stable (useCallback with [])
  }, [open]);

  const checkVaultStatus = async () => {
    try {
      const status = await getVaultStatus();
      setVaultUnlocked(status.unlocked);
    } catch {
      setVaultUnlocked(false);
    }
  };

  const handleExport = async () => {
    await run(async () => {
      const today = new Date().toISOString().split('T')[0];
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = format === 'JSON'
        ? `arsenale-connections-${today}.json`
        : `connections-export-${timestamp}.csv`;

      await downloadExport({
        format,
        includeCredentials: includeCredentials && vaultUnlocked,
        folderId,
        connectionIds,
      }, filename);
    }, 'Export failed');
  };

  const handleClose = () => {
    clearError();
    onClose();
  };

  const scopeText = connectionIds
    ? `${connectionIds.length} selected connection(s)`
    : folderId
    ? 'this folder and subfolders'
    : 'all connections';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Export Connections</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Format</InputLabel>
          <Select
            value={format}
            label="Format"
            onChange={(e) => setFormat(e.target.value as 'CSV' | 'JSON')}
          >
            <MenuItem value="JSON">JSON (Recommended)</MenuItem>
            <MenuItem value="CSV">CSV (Spreadsheet)</MenuItem>
          </Select>
        </FormControl>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Exporting {scopeText}
        </Typography>

        <FormControlLabel
          control={
            <Checkbox
              checked={includeCredentials}
              onChange={(e) => setIncludeCredentials(e.target.checked)}
              disabled={!vaultUnlocked}
            />
          }
          label="Include credentials in export (requires vault unlocked)"
        />

        {includeCredentials && !vaultUnlocked && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Vault is locked. Please unlock your vault to export credentials.
          </Alert>
        )}

        {includeCredentials && vaultUnlocked && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            Credentials will be decrypted and included in plain text. Store this file securely.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleExport}
          variant="contained"
          disabled={loading || (includeCredentials && !vaultUnlocked)}
          startIcon={loading ? <CircularProgress size={20} /> : <DownloadIcon />}
        >
          {loading ? 'Exporting...' : 'Export'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
