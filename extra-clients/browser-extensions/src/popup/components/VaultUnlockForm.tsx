import React, { useState, useEffect } from 'react';
import type { VaultStatusResponse } from '../../types';
import {
  requestVaultWebAuthnOptions,
  unlockVaultWithWebAuthn,
  unlockVault,
  unlockVaultWithTotp,
  unlockVaultWithSms,
  requestVaultSmsCode,
} from '../../lib/vaultApi';
import {
  formatWebAuthnError,
  getExpectedChallenge,
  startWebAuthnAuthentication,
} from '../../lib/webauthn';

interface VaultUnlockFormProps {
  accountId: string;
  vaultStatus: VaultStatusResponse;
  onUnlocked: () => void;
}

type UnlockMethod = 'password' | 'totp' | 'sms';
type ExtendedUnlockMethod = UnlockMethod | 'webauthn';

export function VaultUnlockForm({
  accountId,
  vaultStatus,
  onUnlocked,
}: VaultUnlockFormProps): React.ReactElement {
  const mfaMethods = vaultStatus.mfaUnlockMethods;
  const hasMfa = vaultStatus.mfaUnlockAvailable && mfaMethods.length > 0;

  const availableMethods: ExtendedUnlockMethod[] = ['password'];
  if (hasMfa && mfaMethods.includes('totp')) availableMethods.push('totp');
  if (hasMfa && mfaMethods.includes('sms')) availableMethods.push('sms');
  if (hasMfa && mfaMethods.includes('webauthn')) availableMethods.push('webauthn');

  const [method, setMethod] = useState<ExtendedUnlockMethod>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  // Auto-request SMS code when SMS method is selected
  useEffect(() => {
    if (method === 'sms' && !smsSent) {
      void handleRequestSms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method]);

  const handleRequestSms = async () => {
    setLoading(true);
    setError(null);
    const result = await requestVaultSmsCode(accountId);
    setLoading(false);
    if (result.success) {
      setSmsSent(true);
    } else {
      setError(result.error ?? 'Failed to send SMS code');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let result;

    if (method === 'password') {
      if (!password.trim()) {
        setLoading(false);
        return;
      }
      result = await unlockVault(accountId, password);
    } else if (method === 'totp') {
      if (code.length !== 6) {
        setLoading(false);
        return;
      }
      result = await unlockVaultWithTotp(accountId, code.trim());
    } else if (method === 'sms') {
      if (code.length !== 6) {
        setLoading(false);
        return;
      }
      result = await unlockVaultWithSms(accountId, code.trim());
    } else {
      setLoading(false);
      return;
    }

    setLoading(false);

    if (result.success && result.data?.unlocked) {
      onUnlocked();
    } else {
      setError(result.error ?? 'Unlock failed');
      setPassword('');
      setCode('');
    }
  };

  const handleWebAuthn = async () => {
    setLoading(true);
    setError(null);

    try {
      const optionsResult = await requestVaultWebAuthnOptions(accountId);
      if (!optionsResult.success || !optionsResult.data) {
        setError(optionsResult.error ?? 'Failed to get WebAuthn options');
        return;
      }

      const credential = await startWebAuthnAuthentication(optionsResult.data);
      const result = await unlockVaultWithWebAuthn(
        accountId,
        credential,
        getExpectedChallenge(optionsResult.data),
      );

      if (result.success && result.data?.unlocked) {
        onUnlocked();
      } else {
        setError(result.error ?? 'Unlock failed');
      }
    } catch (err) {
      setError(formatWebAuthnError(err));
    } finally {
      setLoading(false);
    }
  };

  const methodLabels: Record<ExtendedUnlockMethod, string> = {
    password: 'Password',
    totp: 'Authenticator',
    sms: 'SMS Code',
    webauthn: 'Security Key',
  };

  return (
    <div className="vault-unlock-form">
      <div className="vault-unlock-header">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <h3>Unlock Vault</h3>
        <p>Unlock to access your keychain secrets.</p>
      </div>

      {/* Method tabs (only show if MFA options are available) */}
      {availableMethods.length > 1 && (
        <div className="mfa-method-tabs">
          {availableMethods.map((m) => (
            <button
              key={m}
              className={`mfa-method-tab ${method === m ? 'active' : ''}`}
              onClick={() => {
                setMethod(m);
                setCode('');
                setPassword('');
                setError(null);
              }}
              disabled={loading}
            >
              {methodLabels[m]}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {method === 'password' && (
          <div className="form-group">
            <label htmlFor="vault-password">Master Password</label>
            <input
              id="vault-password"
              type="password"
              className="input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
        )}

        {(method === 'totp' || method === 'sms') && (
          <div className="form-group">
            <label htmlFor="vault-code">
              {method === 'totp'
                ? 'Enter 6-digit authenticator code'
                : smsSent
                  ? 'Enter the 6-digit code sent to your phone'
                  : 'Requesting SMS code...'}
            </label>
            <input
              id="vault-code"
              type="text"
              className="input input-code"
              placeholder="000000"
              value={code}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(val);
              }}
              disabled={loading}
              autoFocus
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>
        )}

        {method === 'webauthn' && (
          <div className="mfa-webauthn">
            <p className="mfa-webauthn-info">
              Use your security key or passkey to unlock the vault.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={handleWebAuthn}
              disabled={loading}
            >
              {loading ? 'Waiting...' : 'Use Security Key'}
            </button>
          </div>
        )}

        {method === 'sms' && smsSent && (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={handleRequestSms}
            disabled={loading}
          >
            Resend code
          </button>
        )}

        {error && <p className="form-error">{error}</p>}

        {method !== 'webauthn' && (
          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={
              loading ||
              (method === 'password' && !password.trim()) ||
              ((method === 'totp' || method === 'sms') && code.length !== 6)
            }
          >
            {loading ? 'Unlocking...' : 'Unlock'}
          </button>
        )}
      </form>
    </div>
  );
}
