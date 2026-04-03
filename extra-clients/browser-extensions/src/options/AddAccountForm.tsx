import React, { useEffect, useState } from 'react';
import { healthCheck } from '../lib/apiClient';
import {
  login,
  requestSmsCode,
  requestWebAuthnOptions,
  switchTenant,
  verifySms,
  verifyTotp,
  verifyWebAuthn,
} from '../lib/auth';
import {
  getAcceptedTenantMemberships,
  getPreferredTenantMembership,
} from '../lib/authFlow';
import {
  formatWebAuthnError,
  getExpectedChallenge,
  startWebAuthnAuthentication,
} from '../lib/webauthn';
import type { LoginResponse, LoginResult, PendingAccount, TenantMembership } from '../types';

interface AddAccountFormProps {
  onComplete: () => Promise<void> | void;
  onCancel: () => void;
}

type Step =
  | 'server'
  | 'credentials'
  | 'mfa-choice'
  | 'totp'
  | 'sms'
  | 'webauthn'
  | 'tenant-select'
  | 'mfa-setup';

export function AddAccountForm({
  onComplete,
  onCancel,
}: AddAccountFormProps): React.ReactElement {
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('server');
  const [serverValid, setServerValid] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [mfaMethods, setMfaMethods] = useState<string[]>([]);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [code, setCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [tenantMemberships, setTenantMemberships] = useState<TenantMembership[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null);

  const pendingAccount: PendingAccount = {
    serverUrl: serverUrl.trim(),
    email: email.trim(),
  };

  useEffect(() => {
    if (step !== 'sms' || smsSent) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    requestSmsCode(serverUrl.trim(), tempToken)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setSmsSent(true);
          setError(null);
        } else {
          setError(result.error ?? 'Failed to send SMS code');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [serverUrl, smsSent, step, tempToken]);

  const resetMfaState = () => {
    setTempToken('');
    setMfaMethods([]);
    setRequiresTotp(false);
    setCode('');
    setSmsSent(false);
  };

  const handleAuthenticated = async (result: LoginResult) => {
    const memberships = getAcceptedTenantMemberships(result.tenantMemberships);
    const preferredMembership = getPreferredTenantMembership(memberships);

    if (result.accountId && memberships.length >= 2 && preferredMembership) {
      setCreatedAccountId(result.accountId);
      setTenantMemberships(memberships);
      setSelectedTenantId(preferredMembership.tenantId);
      setStep('tenant-select');
      setLoading(false);
      return;
    }

    await Promise.resolve(onComplete());
  };

  const handleCheckServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverUrl.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const result = await healthCheck(serverUrl.trim());
      if (result.success) {
        setServerValid(true);
        setStep('credentials');
      } else {
        setError(result.error ?? 'Could not connect to server');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    try {
      const result = await login(serverUrl.trim(), email.trim(), password);
      if (!result.success || !result.data) {
        setError(result.error ?? 'Login failed');
        return;
      }

      const data = result.data as LoginResponse;
      if ('mfaSetupRequired' in data && data.mfaSetupRequired) {
        setTempToken(data.tempToken);
        setStep('mfa-setup');
        return;
      }

      if ('requiresMFA' in data && data.requiresMFA) {
        setTempToken(data.tempToken);
        setMfaMethods(data.methods);
        setRequiresTotp(Boolean(data.requiresTOTP));
        setCode('');
        setSmsSent(false);

        if (data.methods.length === 1) {
          const onlyMethod = data.methods[0];
          setStep(onlyMethod === 'sms' ? 'sms' : onlyMethod === 'webauthn' ? 'webauthn' : 'totp');
        } else {
          setStep('mfa-choice');
        }
        return;
      }

      if ('accessToken' in data) {
        await handleAuthenticated(data);
        return;
      }

      setError('Unexpected login response');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (method: 'totp' | 'sms') => {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);

    try {
      const result = method === 'totp'
        ? await verifyTotp(serverUrl.trim(), tempToken, code, pendingAccount)
        : await verifySms(serverUrl.trim(), tempToken, code, pendingAccount);

      if (result.success && result.data) {
        await handleAuthenticated(result.data);
      } else {
        setError(result.error ?? 'Verification failed');
        setCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleWebAuthn = async () => {
    setLoading(true);
    setError(null);

    try {
      const optionsResult = await requestWebAuthnOptions(serverUrl.trim(), tempToken);
      if (!optionsResult.success || !optionsResult.data) {
        setError(optionsResult.error ?? 'Failed to get WebAuthn options');
        return;
      }

      const credential = await startWebAuthnAuthentication(optionsResult.data);
      const verifyResult = await verifyWebAuthn(
        serverUrl.trim(),
        tempToken,
        credential,
        pendingAccount,
        getExpectedChallenge(optionsResult.data),
      );

      if (verifyResult.success && verifyResult.data) {
        await handleAuthenticated(verifyResult.data);
      } else {
        setError(verifyResult.error ?? 'WebAuthn authentication failed.');
      }
    } catch (err) {
      setError(formatWebAuthnError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleChooseMethod = (method: string) => {
    setError(null);
    setCode('');
    setSmsSent(false);

    if (method === 'sms') {
      setStep('sms');
      return;
    }

    if (method === 'webauthn') {
      setStep('webauthn');
      return;
    }

    setStep('totp');
  };

  const handleTenantConfirm = async () => {
    if (!createdAccountId || !selectedTenantId) return;

    const activeMembership = tenantMemberships.find((membership) => membership.isActive);
    if (activeMembership?.tenantId === selectedTenantId) {
      await Promise.resolve(onComplete());
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await switchTenant(createdAccountId, selectedTenantId);
      if (!result.success) {
        setError(result.error ?? 'Failed to switch organization');
        return;
      }

      await Promise.resolve(onComplete());
    } finally {
      setLoading(false);
    }
  };

  const handleBackToCredentials = () => {
    resetMfaState();
    setError(null);
    setStep('credentials');
  };

  const handleBackToServer = () => {
    resetMfaState();
    setServerValid(false);
    setError(null);
    setStep('server');
  };

  const renderActions = (
    primary: React.ReactNode,
    secondaryLabel = 'Cancel',
    secondaryAction: () => void = onCancel,
  ) => (
    <div className="add-account-actions">
      {primary}
      <button type="button" className="btn btn-ghost" onClick={secondaryAction} disabled={loading}>
        {secondaryLabel}
      </button>
    </div>
  );

  return (
    <div className="add-account-form">
      {step === 'server' && (
        <form onSubmit={handleCheckServer}>
          <div className="form-group">
            <label htmlFor="serverUrl">Server URL</label>
            <input
              id="serverUrl"
              type="text"
              className="input"
              placeholder="https://arsenale.example.com"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          {renderActions(
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !serverUrl.trim()}
            >
              {loading ? 'Checking...' : 'Check Connection'}
            </button>,
          )}
        </form>
      )}

      {step === 'credentials' && (
        <form onSubmit={handleLogin}>
          <div className="form-server-info">
            <span className="form-server-badge">
              {serverValid ? 'Connected' : 'Checking...'}
            </span>
            <span className="form-server-url">{serverUrl}</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={handleBackToServer}>
              Change
            </button>
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          {renderActions(
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !email.trim() || !password}
            >
              {loading ? 'Signing in...' : 'Add Account'}
            </button>,
          )}
        </form>
      )}

      {step === 'mfa-choice' && (
        <div className="auth-method-grid">
          {requiresTotp && (
            <button type="button" className="btn btn-ghost auth-method-btn" onClick={() => handleChooseMethod('totp')}>
              Authenticator App
            </button>
          )}
          {!requiresTotp && mfaMethods.includes('totp') && (
            <button type="button" className="btn btn-ghost auth-method-btn" onClick={() => handleChooseMethod('totp')}>
              Authenticator App
            </button>
          )}
          {mfaMethods.includes('sms') && (
            <button type="button" className="btn btn-ghost auth-method-btn" onClick={() => handleChooseMethod('sms')}>
              SMS Code
            </button>
          )}
          {mfaMethods.includes('webauthn') && (
            <button type="button" className="btn btn-ghost auth-method-btn" onClick={() => handleChooseMethod('webauthn')}>
              Security Key / Passkey
            </button>
          )}
          {renderActions(<span />, 'Back', handleBackToCredentials)}
        </div>
      )}

      {(step === 'totp' || step === 'sms') && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleVerifyCode(step);
          }}
        >
          <div className="form-group">
            <label htmlFor="mfa-code">
              {step === 'totp'
                ? 'Authenticator code'
                : smsSent
                  ? 'SMS code'
                  : 'Sending SMS code...'}
            </label>
            <input
              id="mfa-code"
              type="text"
              className="input"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={loading}
              autoFocus
              inputMode="numeric"
              maxLength={6}
            />
          </div>
          {step === 'sms' && smsSent && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => {
                setSmsSent(false);
                setError(null);
              }}
              disabled={loading}
            >
              Resend code
            </button>
          )}
          {error && <p className="form-error">{error}</p>}
          {renderActions(
            <button type="submit" className="btn btn-primary" disabled={loading || code.length !== 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>,
            'Back',
            mfaMethods.length > 1 ? () => setStep('mfa-choice') : handleBackToCredentials,
          )}
        </form>
      )}

      {step === 'webauthn' && (
        <div className="auth-info-block">
          <p className="auth-info-text">
            Use your security key or passkey to complete sign-in.
          </p>
          {error && <p className="form-error">{error}</p>}
          {renderActions(
            <button type="button" className="btn btn-primary" onClick={handleWebAuthn} disabled={loading}>
              {loading ? 'Waiting...' : 'Authenticate'}
            </button>,
            'Back',
            mfaMethods.length > 1 ? () => setStep('mfa-choice') : handleBackToCredentials,
          )}
        </div>
      )}

      {step === 'tenant-select' && (
        <div className="tenant-select-panel">
          <p className="auth-info-text">Choose the organization to use for this account.</p>
          <ul className="tenant-list">
            {tenantMemberships.map((membership) => (
              <li key={membership.tenantId} className="tenant-list-item">
                <button
                  type="button"
                  className={`tenant-option ${membership.tenantId === selectedTenantId ? 'selected' : ''}`}
                  onClick={() => setSelectedTenantId(membership.tenantId)}
                  disabled={loading}
                >
                  <span className="tenant-avatar">{membership.name[0]?.toUpperCase() ?? '?'}</span>
                  <span className="tenant-meta">
                    <span className="tenant-name">{membership.name}</span>
                    <span className="tenant-role">{membership.role}</span>
                  </span>
                  {membership.isActive && <span className="badge badge-active">Current</span>}
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="form-error">{error}</p>}
          {renderActions(
            <button type="button" className="btn btn-primary" onClick={handleTenantConfirm} disabled={loading || !selectedTenantId}>
              {loading ? 'Saving...' : 'Continue'}
            </button>,
            'Keep Current',
            async () => {
              await Promise.resolve(onComplete());
            },
          )}
        </div>
      )}

      {step === 'mfa-setup' && (
        <div className="auth-info-block">
          <p className="auth-info-text">
            This account requires first-time MFA setup in the Arsenale web UI.
          </p>
          {error && <p className="form-error">{error}</p>}
          {renderActions(
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const normalized = serverUrl.includes('://') ? serverUrl : `https://${serverUrl}`;
                chrome.tabs.create({ url: `${normalized.replace(/\/+$/, '')}/login` });
              }}
            >
              Open Web UI
            </button>,
            'Back',
            handleBackToCredentials,
          )}
        </div>
      )}
    </div>
  );
}
