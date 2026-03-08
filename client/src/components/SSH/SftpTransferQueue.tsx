import {
  Box, Typography, IconButton, LinearProgress, Collapse, List, ListItem,
  ListItemIcon, ListItemText, Button,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Upload as UploadIcon,
  Download as DownloadIcon,
  Cancel as CancelIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import type { TransferItem } from '../../hooks/useSftpTransfers';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SftpTransferQueueProps {
  transfers: TransferItem[];
  onCancel: (transferId: string) => void;
  onClearCompleted: () => void;
}

export default function SftpTransferQueue({ transfers, onCancel, onClearCompleted }: SftpTransferQueueProps) {
  const open = useUiPreferencesStore((s) => s.sshSftpTransferQueueOpen);
  const toggle = useUiPreferencesStore((s) => s.toggle);

  const hasCompleted = transfers.some((t) => t.status !== 'active');

  if (transfers.length === 0) return null;

  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
      <Box
        sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.5, cursor: 'pointer' }}
        onClick={() => toggle('sshSftpTransferQueueOpen')}
      >
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
          Transfers ({transfers.length})
        </Typography>
        {hasCompleted && (
          <Button
            size="small"
            sx={{ fontSize: '0.7rem', minWidth: 0, px: 0.5 }}
            onClick={(e) => { e.stopPropagation(); onClearCompleted(); }}
          >
            Clear
          </Button>
        )}
        <IconButton size="small">
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>

      <Collapse in={open}>
        <List dense sx={{ maxHeight: 200, overflow: 'auto', py: 0 }}>
          {transfers.map((t) => {
            const progress = t.totalBytes > 0 ? (t.bytesTransferred / t.totalBytes) * 100 : 0;

            return (
              <ListItem key={t.transferId} sx={{ py: 0.25 }}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  {t.status === 'complete' ? (
                    <CheckIcon fontSize="small" color="success" />
                  ) : t.status === 'error' ? (
                    <ErrorIcon fontSize="small" color="error" />
                  ) : t.status === 'cancelled' ? (
                    <CancelIcon fontSize="small" color="disabled" />
                  ) : t.direction === 'upload' ? (
                    <UploadIcon fontSize="small" color="primary" />
                  ) : (
                    <DownloadIcon fontSize="small" color="primary" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={t.filename}
                  secondary={
                    t.status === 'error'
                      ? t.errorMessage
                      : t.status === 'active'
                        ? `${formatSize(t.bytesTransferred)} / ${formatSize(t.totalBytes)}`
                        : t.status === 'complete'
                          ? formatSize(t.totalBytes)
                          : t.status
                  }
                  primaryTypographyProps={{ noWrap: true, fontSize: '0.8rem' }}
                  secondaryTypographyProps={{
                    noWrap: true,
                    fontSize: '0.7rem',
                    color: t.status === 'error' ? 'error' : undefined,
                  }}
                />
                {t.status === 'active' && (
                  <>
                    <Box sx={{ width: 60, mx: 1 }}>
                      <LinearProgress variant="determinate" value={progress} />
                    </Box>
                    <IconButton size="small" onClick={() => onCancel(t.transferId)}>
                      <CancelIcon fontSize="small" />
                    </IconButton>
                  </>
                )}
              </ListItem>
            );
          })}
        </List>
      </Collapse>
    </Box>
  );
}
