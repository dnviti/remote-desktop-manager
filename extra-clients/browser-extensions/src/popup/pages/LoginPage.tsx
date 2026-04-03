import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sendMessage } from '../../lib/apiClient';
import type { BackgroundResponse, LoginResponse, LoginResult } from '../../types';

// ── Rate-limiting constants ──────────────────────────────────────────
const MAX_ATTEMPTS_BEFORE_LOCKOUT = 3;
const LOCKOUT_DURATION_SECONDS = 30;
const STORAGE_KEY = 'arsenale_login_attempts';

/** Persisted rate-limit state (survives popup close/reopen). */
interface RateLimitState {
  /** Number of consecutive failed login attempts. */
  failedAttempts: number;
  /** ISO-8601 timestamp when the lockout expires (null if not locked). */
  lockoutUntil: string | null;
}

function loadRateLimitState(): RateLimitState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RateLimitState;
      return parsed;
    }
  } catch {
    // Ignore parse errors — fall through to default
  }
  return { failedAttempts: 0, lockoutUntil: null };
}

function saveRateLimitState(state: RateLimitState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Silently ignore storage errors
  }
}

function clearRateLimitState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently ignore
  }
}

interface LoginPageProps {
  /** Called when login needs MFA verification. */
  onMfaRequired: (
    serverUrl: string,
    email: string,
    tempToken: string,
    methods: string[],
    requiresTOTP: boolean,
  ) => void;
  /** Called when MFA setup is required (opens web UI). */
  onMfaSetupRequired: (serverUrl: string) => void;
  /** Called after successful login (no MFA). */
  onSuccess: (result: LoginResult) => void;
}

export function LoginPage({
  onMfaRequired,
  onMfaSetupRequired,
  onSuccess,
}: LoginPageProps): React.ReactElement {
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'server' | 'credentials'>('server');
  const [serverValid, setServerValid] = useState(false);

  // ── Rate-limiting state ──────────────────────────────────────────
  const [_failedAttempts, setFailedAttempts] = useState<number>(() => loadRateLimitState().failedAttempts);
  const [lockoutRemaining, setLockoutRemaining] = useState<number>(0);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLockedOut = lockoutRemaining > 0;

  /** Start or resume the countdown timer. */
  const startLockoutTimer = useCallback((seconds: number) => {
    // Clear any existing timer
    if (lockoutTimerRef.current) {
      clearInterval(lockoutTimerRef.current);
    }
    setLockoutRemaining(seconds);
    lockoutTimerRef.current = setInterval(() => {
      setLockoutRemaining((prev) => {
        if (prev <= 1) {
          if (lockoutTimerRef.current) {
            clearInterval(lockoutTimerRef.current);
            lockoutTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  /** Record a failed attempt and trigger lockout when threshold is reached. */
  const recordFailedAttempt = useCallback(() => {
    setFailedAttempts((prev) => {
      const next = prev + 1;
      if (next >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
        const lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_SECONDS * 1000).toISOString();
        saveRateLimitState({ failedAttempts: next, lockoutUntil });
        startLockoutTimer(LOCKOUT_DURATION_SECONDS);
      } else {
        saveRateLimitState({ failedAttempts: next, lockoutUntil: null });
      }
      return next;
    });
  }, [startLockoutTimer]);

  /** Reset rate-limit state on successful login. */
  const resetRateLimit = useCallback(() => {
    setFailedAttempts(0); // Reset attempt counter
    setLockoutRemaining(0);
    if (lockoutTimerRef.current) {
      clearInterval(lockoutTimerRef.current);
      lockoutTimerRef.current = null;
    }
    clearRateLimitState();
  }, []);

  // On mount: restore lockout timer if a lockout is still active
  useEffect(() => {
    const state = loadRateLimitState();
    if (state.lockoutUntil) {
      const remaining = Math.ceil((new Date(state.lockoutUntil).getTime() - Date.now()) / 1000);
      if (remaining > 0) {
        startLockoutTimer(remaining);
      } else {
        // Lockout expired while popup was closed — keep attempt count but clear lockout
        saveRateLimitState({ failedAttempts: state.failedAttempts, lockoutUntil: null });
      }
    }
    return () => {
      if (lockoutTimerRef.current) {
        clearInterval(lockoutTimerRef.current);
      }
    };
  }, [startLockoutTimer]);

  const handleCheckServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverUrl.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const { healthCheck } = await import('../../lib/apiClient');
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
    if (!email.trim() || !password || isLockedOut) return;
    setLoading(true);
    setError(null);

    try {
      const result: BackgroundResponse<LoginResponse> = await sendMessage<LoginResponse>({
        type: 'LOGIN',
        serverUrl: serverUrl.trim(),
        email: email.trim(),
        password,
      });

      if (!result.success) {
        recordFailedAttempt();
        setError(result.error ?? 'Login failed');
        return;
      }

      const data = result.data;
      if (!data) {
        recordFailedAttempt();
        setError('Unexpected empty response');
        return;
      }

      // MFA setup required — open the web UI for setup
      if ('mfaSetupRequired' in data && data.mfaSetupRequired) {
        resetRateLimit();
        onMfaSetupRequired(serverUrl.trim());
        return;
      }

      // MFA verification required — navigate to MFA page
      if ('requiresMFA' in data && data.requiresMFA) {
        resetRateLimit();
        onMfaRequired(
          serverUrl.trim(),
          email.trim(),
          data.tempToken,
          data.methods,
          data.requiresTOTP ?? false,
        );
        return;
      }

      // Full success
      if (!('accessToken' in data)) {
        recordFailedAttempt();
        setError('Unexpected login response');
        return;
      }

      resetRateLimit();
      onSuccess(data);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep('server');
    setServerValid(false);
    setError(null);
  };

  return (
    <div className="login-page">
      <div className="login-header">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <h2>Sign In</h2>
        <p>Connect to your Arsenale server.</p>
      </div>

      {step === 'server' && (
        <form onSubmit={handleCheckServer}>
          <div className="form-group">
            <label htmlFor="login-server">Server URL</label>
            <input
              id="login-server"
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
          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading || !serverUrl.trim()}
          >
            {loading ? 'Checking...' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'credentials' && (
        <form onSubmit={handleLogin}>
          <div className="form-server-info">
            <span className="form-server-badge">
              {serverValid ? 'Connected' : 'Checking...'}
            </span>
            <span className="form-server-url">{serverUrl}</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={handleBack}>
              Change
            </button>
          </div>
          <div className="form-group">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
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
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              className="input"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>
          {error && <p className="form-error">{error}</p>}
          {isLockedOut && (
            <p className="form-error">
              Too many failed attempts. Try again in {lockoutRemaining}s.
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={loading || !email.trim() || !password || isLockedOut}
          >
            {isLockedOut
              ? `Locked (${lockoutRemaining}s)`
              : loading
                ? 'Signing in...'
                : 'Sign In'}
          </button>
        </form>
      )}
    </div>
  );
}
