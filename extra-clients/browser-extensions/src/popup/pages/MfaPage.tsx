import React, { useState, useEffect } from 'react';
import { sendMessage } from '../../lib/apiClient';
import type { BackgroundResponse, LoginResult, PendingAccount } from '../../types';

interface MfaPageProps {
  serverUrl: string;
  email: string;
  tempToken: string;
  methods: string[];
  requiresTOTP: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

type MfaMethod = 'totp' | 'sms' | 'webauthn';

export function MfaPage({
  serverUrl,
  email,
  tempToken,
  methods,
  requiresTOTP,
  onSuccess,
  onCancel,
}: MfaPageProps): React.ReactElement {
  const availableMethods: MfaMethod[] = [];
  if (requiresTOTP || methods.includes('totp')) availableMethods.push('totp');
  if (methods.includes('sms')) availableMethods.push('sms');
  if (methods.includes('webauthn')) availableMethods.push('webauthn');

  const [activeMethod, setActiveMethod] = useState<MfaMethod>(availableMethods[0] ?? 'totp');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  const pendingAccount: PendingAccount = { serverUrl, email };

  // Auto-request SMS code when SMS method is selected
  useEffect(() => {
    if (activeMethod === 'sms' && !smsSent) {
      void requestSms();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMethod]);

  const requestSms = async () => {
    setLoading(true);
    setError(null);
    const result = await sendMessage({ type: 'REQUEST_SMS_CODE', serverUrl, tempToken });
    setLoading(false);
    if (result.success) {
      setSmsSent(true);
    } else {
      setError(result.error ?? 'Failed to send SMS code');
    }
  };

  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || code.length !== 6) return;
    setLoading(true);
    setError(null);

    let result: BackgroundResponse<LoginResult>;

    if (activeMethod === 'totp') {
      result = await sendMessage<LoginResult>({
        type: 'VERIFY_TOTP',
        serverUrl,
        tempToken,
        code: code.trim(),
        pendingAccount,
      });
    } else {
      result = await sendMessage<LoginResult>({
        type: 'VERIFY_SMS',
        serverUrl,
        tempToken,
        code: code.trim(),
        pendingAccount,
      });
    }

    setLoading(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? 'Verification failed');
      setCode('');
    }
  };

  const handleWebAuthn = async () => {
    setLoading(true);
    setError(null);

    // Step 1: Get WebAuthn options from server
    const optionsResult = await sendMessage<Record<string, unknown>>({
      type: 'REQUEST_WEBAUTHN_OPTIONS',
      serverUrl,
      tempToken,
    });

    if (!optionsResult.success || !optionsResult.data) {
      setError(optionsResult.error ?? 'Failed to get WebAuthn options');
      setLoading(false);
      return;
    }

    // Step 2: WebAuthn is not available in extension popups — inform user
    // The navigator.credentials API is not accessible from extension contexts.
    setError(
      'WebAuthn is not supported in extension popups. ' +
      'Please use the Arsenale web UI or choose another verification method.',
    );
    setLoading(false);
  };

  const methodLabels: Record<MfaMethod, string> = {
    totp: 'Authenticator App',
    sms: 'SMS Code',
    webauthn: 'Security Key',
  };

  return (
    <div className="mfa-page">
      <div className="login-header">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 019.9-1" />
        </svg>
        <h2>Two-Factor Authentication</h2>
        <p>Verify your identity to continue.</p>
      </div>

      {/* Method tabs */}
      {availableMethods.length > 1 && (
        <div className="mfa-method-tabs">
          {availableMethods.map((method) => (
            <button
              key={method}
              className={`mfa-method-tab ${activeMethod === method ? 'active' : ''}`}
              onClick={() => {
                setActiveMethod(method);
                setCode('');
                setError(null);
              }}
              disabled={loading}
            >
              {methodLabels[method]}
            </button>
          ))}
        </div>
      )}

      {/* TOTP / SMS code input */}
      {(activeMethod === 'totp' || activeMethod === 'sms') && (
        <form onSubmit={handleSubmitCode}>
          <div className="form-group">
            <label htmlFor="mfa-code">
              {activeMethod === 'totp'
                ? 'Enter the 6-digit code from your authenticator app'
                : smsSent
                  ? 'Enter the 6-digit code sent to your phone'
                  : 'Requesting SMS code...'}
            </label>
            <input
              id="mfa-code"
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
          {activeMethod === 'sms' && smsSent && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={requestSms}
              disabled={loading}
            >
              Resend code
            </button>
          )}
          {error && <p className="form-error">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading || code.length !== 6}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </form>
      )}

      {/* WebAuthn */}
      {activeMethod === 'webauthn' && (
        <div className="mfa-webauthn">
          <p className="mfa-webauthn-info">
            Use your security key or biometric to authenticate.
          </p>
          {error && <p className="form-error">{error}</p>}
          <button
            className="btn btn-primary btn-full"
            onClick={handleWebAuthn}
            disabled={loading}
          >
            {loading ? 'Waiting...' : 'Use Security Key'}
          </button>
        </div>
      )}

      <button
        className="btn btn-ghost btn-full mfa-cancel"
        onClick={onCancel}
        disabled={loading}
      >
        Cancel
      </button>
    </div>
  );
}
