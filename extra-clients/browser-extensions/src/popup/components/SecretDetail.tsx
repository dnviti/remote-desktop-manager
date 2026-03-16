import React, { useEffect, useState, useCallback, useRef } from 'react';
import type {
  SecretListItem,
  SecretDetail as SecretDetailType,
  SecretPayload,
  LoginData,
  SshKeyData,
  CertificateData,
  ApiKeyData,
  SecureNoteData,
} from '../../types';
import { getSecret } from '../../lib/secretsApi';
import { copyToClipboard } from '../../lib/clipboard';

interface SecretDetailProps {
  accountId: string;
  secret: SecretListItem;
  onBack: () => void;
  /** Called when vault is locked and the detail cannot be fetched. */
  onVaultLocked: () => void;
}

/** A single copiable field row. */
function CopyField({
  label,
  value,
  masked = false,
}: {
  label: string;
  value: string;
  masked?: boolean;
}): React.ReactElement {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const displayValue = masked && !revealed
    ? '\u2022'.repeat(Math.min(value.length, 20))
    : value;

  return (
    <div className="secret-field">
      <div className="secret-field-header">
        <span className="secret-field-label">{label}</span>
        <div className="secret-field-actions">
          {masked && (
            <button
              className="btn btn-icon btn-xs"
              onClick={() => setRevealed(!revealed)}
              title={revealed ? 'Hide' : 'Reveal'}
              aria-label={revealed ? 'Hide' : 'Reveal'}
            >
              {revealed ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          )}
          <button
            className="btn btn-icon btn-xs"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy'}
            aria-label={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>
      <div className="secret-field-value">{displayValue}</div>
    </div>
  );
}

/** Render fields for a specific secret payload type. */
function PayloadFields({ data }: { data: SecretPayload }): React.ReactElement {
  switch (data.type) {
    case 'LOGIN':
      return <LoginFields data={data} />;
    case 'SSH_KEY':
      return <SshKeyFields data={data} />;
    case 'CERTIFICATE':
      return <CertificateFields data={data} />;
    case 'API_KEY':
      return <ApiKeyFields data={data} />;
    case 'SECURE_NOTE':
      return <SecureNoteFields data={data} />;
  }
}

function LoginFields({ data }: { data: LoginData }): React.ReactElement {
  return (
    <>
      {data.username && <CopyField label="Username" value={data.username} />}
      {data.password && <CopyField label="Password" value={data.password} masked />}
      {data.domain && <CopyField label="Domain" value={data.domain} />}
      {data.url && <CopyField label="URL" value={data.url} />}
      {data.notes && <CopyField label="Notes" value={data.notes} />}
    </>
  );
}

function SshKeyFields({ data }: { data: SshKeyData }): React.ReactElement {
  return (
    <>
      {data.username && <CopyField label="Username" value={data.username} />}
      <CopyField label="Private Key" value={data.privateKey} masked />
      {data.publicKey && <CopyField label="Public Key" value={data.publicKey} />}
      {data.passphrase && <CopyField label="Passphrase" value={data.passphrase} masked />}
      {data.algorithm && <CopyField label="Algorithm" value={data.algorithm} />}
      {data.notes && <CopyField label="Notes" value={data.notes} />}
    </>
  );
}

function CertificateFields({ data }: { data: CertificateData }): React.ReactElement {
  return (
    <>
      <CopyField label="Certificate" value={data.certificate} />
      <CopyField label="Private Key" value={data.privateKey} masked />
      {data.chain && <CopyField label="Chain" value={data.chain} />}
      {data.passphrase && <CopyField label="Passphrase" value={data.passphrase} masked />}
      {data.expiresAt && <CopyField label="Expires" value={data.expiresAt} />}
      {data.notes && <CopyField label="Notes" value={data.notes} />}
    </>
  );
}

function ApiKeyFields({ data }: { data: ApiKeyData }): React.ReactElement {
  return (
    <>
      <CopyField label="API Key" value={data.apiKey} masked />
      {data.endpoint && <CopyField label="Endpoint" value={data.endpoint} />}
      {data.headers && Object.keys(data.headers).length > 0 && (
        <CopyField label="Headers" value={JSON.stringify(data.headers, null, 2)} />
      )}
      {data.notes && <CopyField label="Notes" value={data.notes} />}
    </>
  );
}

function SecureNoteFields({ data }: { data: SecureNoteData }): React.ReactElement {
  return (
    <CopyField label="Content" value={data.content} />
  );
}

export function SecretDetail({
  accountId,
  secret,
  onBack,
  onVaultLocked,
}: SecretDetailProps): React.ReactElement {
  const [detail, setDetail] = useState<SecretDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);

    const res = await getSecret(accountId, secret.id);
    if (!mountedRef.current) return;

    if (res.success && res.data) {
      setDetail(res.data);
      setLoading(false);
    } else {
      // Detect vault locked
      if (res.error?.includes('403') || res.error?.toLowerCase().includes('vault')) {
        onVaultLocked();
        return;
      }
      setError(res.error ?? 'Failed to load secret');
      setLoading(false);
    }
  }, [accountId, secret.id, onVaultLocked]);

  useEffect(() => {
    mountedRef.current = true;
    loadDetail().catch(() => { /* handled inside */ });
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, secret.id]);

  return (
    <div className="secret-detail-container">
      <div className="secret-detail-header">
        <button className="btn btn-icon" onClick={onBack} title="Back" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <div className="secret-detail-title">
          <h3>{secret.name}</h3>
          {secret.description && (
            <span className="secret-detail-desc">{secret.description}</span>
          )}
        </div>
      </div>

      {loading && (
        <div className="secret-detail-loading">Decrypting...</div>
      )}

      {error && (
        <div className="secret-detail-error">
          <p className="form-error">{error}</p>
          <button className="btn btn-ghost btn-xs" onClick={loadDetail}>Retry</button>
        </div>
      )}

      {!loading && !error && detail && (
        <div className="secret-detail-fields">
          <PayloadFields data={detail.data} />
          {detail.tags.length > 0 && (
            <div className="secret-detail-tags">
              {detail.tags.map((tag) => (
                <span key={tag} className="secret-tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
