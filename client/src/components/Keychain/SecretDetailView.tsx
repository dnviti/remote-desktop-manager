import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Box, Typography, Chip, IconButton, Accordion, AccordionSummary,
  AccordionDetails, Divider, Tooltip, Alert, Button, CircularProgress,
} from '@mui/material';
import {
  Edit as EditIcon, Share as ShareIcon, Delete as DeleteIcon,
  Star, StarBorder, ContentCopy as CopyIcon,
  Visibility, VisibilityOff, ExpandMore as ExpandMoreIcon,
  VpnKey, Key, VerifiedUser, Api, Notes,
  OpenInNew as LinkIcon, Link as ExternalLinkIcon,
  GppBad as BreachIcon, Security as SecurityIcon,
} from '@mui/icons-material';
import type { SecretDetail, SecretPayload, SecretType, SecretScope } from '../../api/secrets.api';
import SecretVersionHistory from './SecretVersionHistory';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

const TYPE_ICONS: Record<SecretType, React.ReactNode> = {
  LOGIN: <VpnKey />,
  SSH_KEY: <Key />,
  CERTIFICATE: <VerifiedUser />,
  API_KEY: <Api />,
  SECURE_NOTE: <Notes />,
};

const TYPE_LABELS: Record<SecretType, string> = {
  LOGIN: 'Login',
  SSH_KEY: 'SSH Key',
  CERTIFICATE: 'Certificate',
  API_KEY: 'API Key',
  SECURE_NOTE: 'Secure Note',
};

const SCOPE_LABELS: Record<SecretScope, string> = {
  PERSONAL: 'Personal',
  TEAM: 'Team',
  TENANT: 'Organization',
};

const AUTO_HIDE_MS = 30_000;

interface SecretDetailViewProps {
  secret: SecretDetail;
  onEdit: () => void;
  onShare: () => void;
  onExternalShare?: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onRestore: () => void;
  onCheckBreach?: (secretId: string) => Promise<number>;
}

function SensitiveField({ label, value }: { label: string; value: string }) {
  const [revealed, setRevealed] = useState(false);
  const { copied, copy: handleCopy } = useCopyToClipboard();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleReveal = () => {
    setRevealed(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setRevealed(false), AUTO_HIDE_MS);
  };

  const handleHide = () => {
    setRevealed(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            fontFamily: revealed ? 'monospace' : undefined,
            wordBreak: 'break-all',
            whiteSpace: revealed ? 'pre-wrap' : undefined,
          }}
        >
          {revealed ? value : '••••••••••••'}
        </Typography>
        <Tooltip title={revealed ? 'Hide' : 'Reveal'}>
          <IconButton size="small" onClick={revealed ? handleHide : handleReveal}>
            {revealed ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
          <IconButton size="small" onClick={() => handleCopy(value)}>
            <CopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

function PlainField({ label, value, copyable, isLink }: { label: string; value: string; copyable?: boolean; isLink?: boolean }) {
  const { copied, copy: handleCopy } = useCopyToClipboard();

  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
          {value}
        </Typography>
        {isLink && value && (
          <Tooltip title="Open in browser">
            <IconButton size="small" onClick={() => window.open(value.startsWith('http') ? value : `https://${value}`, '_blank')}>
              <LinkIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {copyable && (
          <Tooltip title={copied ? 'Copied!' : 'Copy'}>
            <IconButton size="small" onClick={() => handleCopy(value)}>
              <CopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
}

function renderSecretFields(data: SecretPayload) {
  switch (data.type) {
    case 'LOGIN':
      return (
        <>
          <PlainField label="Username" value={data.username} copyable />
          <SensitiveField label="Password" value={data.password} />
          {data.domain && <PlainField label="Domain" value={data.domain} copyable />}
          {data.url && <PlainField label="URL" value={data.url} copyable isLink />}
          {data.notes && <PlainField label="Notes" value={data.notes} />}
        </>
      );
    case 'SSH_KEY':
      return (
        <>
          {data.username && <PlainField label="Username" value={data.username} copyable />}
          <SensitiveField label="Private Key" value={data.privateKey} />
          {data.publicKey && <PlainField label="Public Key" value={data.publicKey} copyable />}
          {data.passphrase && <SensitiveField label="Passphrase" value={data.passphrase} />}
          {data.algorithm && <PlainField label="Algorithm" value={data.algorithm} />}
          {data.notes && <PlainField label="Notes" value={data.notes} />}
        </>
      );
    case 'CERTIFICATE':
      return (
        <>
          <SensitiveField label="Certificate" value={data.certificate} />
          <SensitiveField label="Private Key" value={data.privateKey} />
          {data.chain && <SensitiveField label="CA Chain" value={data.chain} />}
          {data.passphrase && <SensitiveField label="Passphrase" value={data.passphrase} />}
          {data.expiresAt && <PlainField label="Certificate Expires" value={new Date(data.expiresAt).toLocaleDateString()} />}
          {data.notes && <PlainField label="Notes" value={data.notes} />}
        </>
      );
    case 'API_KEY':
      return (
        <>
          <SensitiveField label="API Key" value={data.apiKey} />
          {data.endpoint && <PlainField label="Endpoint" value={data.endpoint} copyable isLink />}
          {data.headers && Object.entries(data.headers).length > 0 && (
            <Box sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary">Headers</Typography>
              {Object.entries(data.headers).map(([k, v]) => (
                <Typography key={k} variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                  {k}: {v}
                </Typography>
              ))}
            </Box>
          )}
          {data.notes && <PlainField label="Notes" value={data.notes} />}
        </>
      );
    case 'SECURE_NOTE':
      return <PlainField label="Content" value={data.content} copyable />;
  }
}

export default function SecretDetailView({
  secret,
  onEdit,
  onShare,
  onExternalShare,
  onDelete,
  onToggleFavorite,
  onRestore,
  onCheckBreach,
}: SecretDetailViewProps) {
  const [breachChecking, setBreachChecking] = useState(false);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const daysUntilExpiry = useMemo(() => {
    if (!secret.expiresAt) return null;
    const now = new Date();
    return Math.ceil((new Date(secret.expiresAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }, [secret.expiresAt]);

  const isReadOnly = secret.shared && secret.permission === 'READ_ONLY';

  const hasCheckablePassword = ['LOGIN', 'SSH_KEY', 'CERTIFICATE'].includes(secret.type);

  const handleCheckBreach = async () => {
    if (!onCheckBreach) return;
    setBreachChecking(true);
    try {
      await onCheckBreach(secret.id);
    } finally {
      setBreachChecking(false);
    }
  };

  return (
    <Box sx={{ p: 2, overflow: 'auto', height: '100%' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        {TYPE_ICONS[secret.type]}
        <Typography variant="h6" sx={{ flex: 1 }}>{secret.name}</Typography>
        <Chip label={TYPE_LABELS[secret.type]} size="small" variant="outlined" />
        <Chip label={SCOPE_LABELS[secret.scope]} size="small" color={secret.scope === 'PERSONAL' ? 'default' : secret.scope === 'TEAM' ? 'primary' : 'secondary'} />
        {secret.shared && (
          <Chip label={secret.permission === 'READ_ONLY' ? 'Read Only' : 'Full Access'} size="small" color="info" variant="outlined" />
        )}
      </Box>

      {/* Action buttons */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={onToggleFavorite} title="Toggle favorite">
          {secret.isFavorite ? <Star color="warning" /> : <StarBorder />}
        </IconButton>
        {!isReadOnly && (
          <>
            <IconButton size="small" onClick={onEdit} title="Edit">
              <EditIcon />
            </IconButton>
            <IconButton size="small" onClick={onShare} title="Share">
              <ShareIcon />
            </IconButton>
            {onExternalShare && (
              <IconButton size="small" onClick={onExternalShare} title="External share link">
                <ExternalLinkIcon />
              </IconButton>
            )}
            <IconButton size="small" onClick={onDelete} title="Delete" color="error">
              <DeleteIcon />
            </IconButton>
          </>
        )}
      </Box>

      {secret.pwnedCount > 0 && (
        <Alert
          severity="error"
          icon={<BreachIcon />}
          sx={{ mb: 2 }}
          action={
            !isReadOnly ? (
              <Button color="error" size="small" onClick={onEdit}>
                Rotate
              </Button>
            ) : undefined
          }
        >
          Password found in {secret.pwnedCount.toLocaleString()} data breach(es). You should change this password immediately.
        </Alert>
      )}

      {daysUntilExpiry !== null && daysUntilExpiry <= 30 && (
        <Alert
          severity={daysUntilExpiry <= 0 ? 'error' : daysUntilExpiry <= 7 ? 'warning' : 'info'}
          sx={{ mb: 2 }}
        >
          {daysUntilExpiry <= 0
            ? 'This secret has expired. Update the credentials or the expiry date.'
            : `This secret expires in ${daysUntilExpiry} day(s). Consider rotating credentials.`}
        </Alert>
      )}

      {hasCheckablePassword && secret.pwnedCount === 0 && onCheckBreach && (
        <Box sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={breachChecking ? <CircularProgress size={16} /> : <SecurityIcon />}
            onClick={handleCheckBreach}
            disabled={breachChecking}
          >
            {breachChecking ? 'Checking...' : 'Check for breaches'}
          </Button>
        </Box>
      )}

      {secret.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {secret.description}
        </Typography>
      )}

      <Divider sx={{ mb: 2 }} />

      {/* Type-specific fields */}
      {renderSecretFields(secret.data)}

      <Divider sx={{ my: 2 }} />

      {/* Metadata */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        {secret.tags.map((t) => (
          <Chip key={t} label={t} size="small" variant="outlined" />
        ))}
      </Box>

      <Typography variant="caption" color="text.secondary" display="block">
        Created: {formatDate(secret.createdAt)}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        Updated: {formatDate(secret.updatedAt)}
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block">
        Version: {secret.currentVersion}
      </Typography>

      {daysUntilExpiry !== null && (
        <Chip
          label={daysUntilExpiry <= 0 ? 'Expired' : `Expires in ${daysUntilExpiry} day(s)`}
          size="small"
          color={daysUntilExpiry <= 0 ? 'error' : daysUntilExpiry <= 7 ? 'error' : daysUntilExpiry <= 30 ? 'warning' : 'default'}
          sx={{ mt: 1 }}
        />
      )}

      {/* Version history */}
      <Accordion sx={{ mt: 2 }} disableGutters elevation={0} variant="outlined">
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">
            Version History
            {secret.currentVersion > 1 && (
              <Chip label={`${secret.currentVersion} versions`} size="small" sx={{ ml: 1, height: 18, fontSize: '0.65rem' }} />
            )}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SecretVersionHistory
            secretId={secret.id}
            currentVersion={secret.currentVersion}
            currentData={secret.data}
            onRestore={onRestore}
          />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
