import React, { useState } from 'react';

interface AddAccountFormProps {
  onSubmit: (serverUrl: string, email: string, password: string) => Promise<{ success: boolean; error?: string }>;
}

export function AddAccountForm({ onSubmit }: AddAccountFormProps): React.ReactElement {
  const [serverUrl, setServerUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'server' | 'credentials'>('server');
  const [serverValid, setServerValid] = useState(false);

  const handleCheckServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverUrl.trim()) return;
    setLoading(true);
    setError(null);

    try {
      // Import dynamically to keep the form component simpler
      const { healthCheck } = await import('../lib/apiClient');
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

    const result = await onSubmit(serverUrl.trim(), email.trim(), password);
    if (!result.success) {
      setError(result.error ?? 'Login failed');
    }
    setLoading(false);
  };

  const handleBack = () => {
    setStep('server');
    setServerValid(false);
    setError(null);
  };

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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !serverUrl.trim()}
          >
            {loading ? 'Checking...' : 'Check Connection'}
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
            <button type="button" className="btn btn-ghost btn-xs" onClick={handleBack}>Change</button>
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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !email.trim() || !password}
          >
            {loading ? 'Logging in...' : 'Add Account'}
          </button>
        </form>
      )}
    </div>
  );
}
