import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, CircularProgress, Chip, Collapse,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
  IconButton, Tooltip,
} from '@mui/material';
import {
  Visibility as ViewIcon,
  VisibilityOff as HideIcon,
  RestorePage as RestoreIcon,
  Circle as DotIcon,
} from '@mui/icons-material';
import { listVersions, restoreVersion, getSecretVersionData } from '../../api/secrets.api';
import type { SecretVersion, SecretPayload } from '../../api/secrets.api';

interface SecretVersionHistoryProps {
  secretId: string;
  currentVersion: number;
  currentData?: SecretPayload;
  onRestore: () => void;
}

/** Extract flat key-value pairs from a SecretPayload for diffing */
function flattenPayload(data: SecretPayload): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'type') continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      entries[key] = JSON.stringify(value);
    } else {
      entries[key] = String(value);
    }
  }
  return entries;
}

function DiffView({ versionData, currentData }: { versionData: SecretPayload; currentData?: SecretPayload }) {
  const versionFields = flattenPayload(versionData);
  const currentFields = currentData ? flattenPayload(currentData) : null;

  const allKeys = new Set([
    ...Object.keys(versionFields),
    ...(currentFields ? Object.keys(currentFields) : []),
  ]);

  return (
    <Box sx={{ mt: 1 }}>
      {[...allKeys].map((key) => {
        const vVal = versionFields[key];
        const cVal = currentFields?.[key];
        const changed = currentFields !== null && vVal !== cVal;
        const isSensitive = ['password', 'privateKey', 'passphrase', 'apiKey', 'certificate', 'chain', 'content'].includes(key);

        return (
          <Box
            key={key}
            sx={{
              mb: 0.5,
              p: 0.75,
              borderRadius: 1,
              bgcolor: changed ? 'warning.50' : 'action.hover',
              border: '1px solid',
              borderColor: changed ? 'warning.light' : 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {key}
              {changed && (
                <Chip label="changed" size="small" color="warning" sx={{ ml: 0.5, height: 16, fontSize: '0.6rem' }} />
              )}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
              }}
            >
              {isSensitive && vVal ? '••••••••' : (vVal ?? '(empty)')}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

export default function SecretVersionHistory({
  secretId,
  currentVersion,
  currentData,
  onRestore,
}: SecretVersionHistoryProps) {
  const [versions, setVersions] = useState<SecretVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  // Expanded version data
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null);
  const [versionData, setVersionData] = useState<Record<number, SecretPayload>>({});
  const [loadingVersion, setLoadingVersion] = useState<number | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listVersions(secretId);
      setVersions(data);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [secretId]);

  useEffect(() => {
    loadVersions();
    setExpandedVersion(null);
    setVersionData({});
  }, [loadVersions]);

  const handleRestore = async (version: number) => {
    setRestoring(true);
    try {
      await restoreVersion(secretId, version);
      setRestoreTarget(null);
      setExpandedVersion(null);
      setVersionData({});
      await loadVersions();
      onRestore();
    } catch {
      // silently fail
    } finally {
      setRestoring(false);
    }
  };

  const handleToggleView = async (version: number) => {
    if (expandedVersion === version) {
      setExpandedVersion(null);
      return;
    }

    setExpandedVersion(version);

    if (!versionData[version]) {
      setLoadingVersion(version);
      try {
        const data = await getSecretVersionData(secretId, version);
        setVersionData((prev) => ({ ...prev, [version]: data }));
      } catch {
        // silently fail — shared secrets can't view version data
        setExpandedVersion(null);
      } finally {
        setLoadingVersion(null);
      }
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (versions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
        No version history available.
      </Typography>
    );
  }

  return (
    <Box>
      {versions.map((v, idx) => {
        const isCurrent = v.version === currentVersion;
        const isLast = idx === versions.length - 1;
        const isExpanded = expandedVersion === v.version;
        const isLoadingData = loadingVersion === v.version;

        return (
          <Box key={v.id} sx={{ display: 'flex', gap: 1.5 }}>
            {/* Timeline line + dot */}
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
              <DotIcon
                sx={{
                  fontSize: 12,
                  color: isCurrent ? 'primary.main' : 'grey.400',
                  mt: 0.5,
                }}
              />
              {!isLast && (
                <Box sx={{ flex: 1, width: 2, bgcolor: 'divider', minHeight: 24 }} />
              )}
            </Box>

            {/* Content */}
            <Box sx={{ flex: 1, pb: 1.5, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: isCurrent ? 600 : 400 }}>
                  Version {v.version}
                </Typography>
                {isCurrent && (
                  <Chip label="current" size="small" color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />
                )}

                <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                  <Tooltip title={isExpanded ? 'Hide data' : 'View data'}>
                    <IconButton
                      size="small"
                      onClick={() => handleToggleView(v.version)}
                      disabled={isLoadingData}
                    >
                      {isLoadingData ? (
                        <CircularProgress size={16} />
                      ) : isExpanded ? (
                        <HideIcon fontSize="small" />
                      ) : (
                        <ViewIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                  {!isCurrent && (
                    <Tooltip title="Restore this version">
                      <IconButton size="small" onClick={() => setRestoreTarget(v.version)}>
                        <RestoreIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>

              <Typography variant="caption" color="text.secondary">
                {v.changer?.username || v.changer?.email || 'Unknown'} — {formatDate(v.createdAt)}
              </Typography>
              {v.changeNote && (
                <Typography variant="caption" display="block" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  {v.changeNote}
                </Typography>
              )}

              {/* Expanded version data with diff */}
              <Collapse in={isExpanded && !!versionData[v.version]}>
                {versionData[v.version] && (
                  <DiffView
                    versionData={versionData[v.version]}
                    currentData={isCurrent ? undefined : currentData}
                  />
                )}
              </Collapse>
            </Box>
          </Box>
        );
      })}

      <Dialog open={restoreTarget !== null} onClose={() => setRestoreTarget(null)}>
        <DialogTitle>Restore Version</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Restore to version {restoreTarget}? This will create a new version with the restored data.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreTarget(null)}>Cancel</Button>
          <Button
            onClick={() => handleRestore(restoreTarget!)}
            variant="contained"
            disabled={restoring}
          >
            {restoring ? 'Restoring...' : 'Restore'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
