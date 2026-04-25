import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  Fingerprint,
  KeyRound,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Smartphone,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { startAuthentication } from '@simplewebauthn/browser';
import {
  requestVaultSmsCode,
  requestVaultWebAuthnOptions,
  unlockVault,
  unlockVaultWithSms,
  unlockVaultWithTotp,
  unlockVaultWithWebAuthn,
} from '../../api/vault.api';
import { logoutApi } from '../../api/auth.api';
import { useAuthStore } from '../../store/authStore';
import { useVaultStore } from '../../store/vaultStore';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { broadcastVaultWindowSync } from '../../utils/vaultWindowSync';

type UnlockMethod = 'webauthn' | 'totp' | 'sms' | 'password';

const METHOD_PRIORITY: UnlockMethod[] = ['webauthn', 'totp', 'sms', 'password'];

function resolveAvailableMethods(
  mfaUnlockAvailable: boolean,
  mfaUnlockMethods: string[],
): UnlockMethod[] {
  return mfaUnlockAvailable
    ? METHOD_PRIORITY.filter((method) => method === 'password' || mfaUnlockMethods.includes(method))
    : ['password'];
}

function getMethodLabel(method: UnlockMethod) {
  switch (method) {
    case 'webauthn':
      return 'passkey';
    case 'totp':
      return 'authenticator app';
    case 'sms':
      return 'SMS code';
    case 'password':
      return 'password';
  }
}

function getMethodIcon(method: UnlockMethod) {
  switch (method) {
    case 'webauthn':
      return <Fingerprint className="size-4" />;
    case 'totp':
      return <Smartphone className="size-4" />;
    case 'sms':
      return <MessageSquareText className="size-4" />;
    case 'password':
      return <KeyRound className="size-4" />;
  }
}

function NumericCodeField({
  id,
  autoFocus = false,
  label,
  onChange,
  onKeyDown,
  value,
}: {
  autoFocus?: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  value: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        autoFocus={autoFocus}
        value={value}
        inputMode="numeric"
        maxLength={6}
        pattern="[0-9]*"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/80 bg-muted/30 px-4 py-5 text-center">
      <Loader2 className="size-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export default function VaultLockedOverlay() {
  const unlocked = useVaultStore((state) => state.unlocked);
  const initialized = useVaultStore((state) => state.initialized);
  const mfaUnlockAvailable = useVaultStore((state) => state.mfaUnlockAvailable);
  const mfaUnlockMethods = useVaultStore((state) => state.mfaUnlockMethods);
  const checkVaultStatus = useVaultStore((state) => state.checkStatus);
  const setVaultUnlocked = useVaultStore((state) => state.setUnlocked);
  const authLogout = useAuthStore((state) => state.logout);

  const [selectedMethod, setSelectedMethod] = useState<UnlockMethod | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [smsSent, setSmsSent] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const { loading, error, clearError, run } = useAsyncAction();
  const autoWebAuthnTriggeredRef = useRef(false);
  const lockStatusResolvedRef = useRef(false);
  const mountedRef = useRef(true);

  const needsLockStatusRefresh =
    initialized
    && !unlocked
    && !mfaUnlockAvailable
    && mfaUnlockMethods.length === 0;

  const availableMethods = useMemo(
    () => resolveAvailableMethods(mfaUnlockAvailable, mfaUnlockMethods),
    [mfaUnlockAvailable, mfaUnlockMethods],
  );
  const preferredMethod = availableMethods[0] ?? 'password';
  const activeMethod = selectedMethod && availableMethods.includes(selectedMethod)
    ? selectedMethod
    : preferredMethod;
  const otherMethods = availableMethods.filter((method) => method !== activeMethod);

  const resetInputs = useCallback(() => {
    clearError();
    setCode('');
    setPassword('');
    setSmsSent(false);
  }, [clearError]);

  const handleMethodSelect = useCallback((method: UnlockMethod) => {
    setSelectedMethod(method);
    resetInputs();
    if (method === 'webauthn') {
      autoWebAuthnTriggeredRef.current = false;
    }
  }, [resetInputs]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const refreshLockStatus = useCallback(async () => {
    setStatusRefreshing(true);
    try {
      await checkVaultStatus();
    } finally {
      if (mountedRef.current) {
        setStatusRefreshing(false);
      }
    }
  }, [checkVaultStatus]);

  useEffect(() => {
    if (unlocked) {
      lockStatusResolvedRef.current = false;
      return;
    }
    if (!needsLockStatusRefresh || lockStatusResolvedRef.current) {
      return;
    }

    lockStatusResolvedRef.current = true;
    void refreshLockStatus();
  }, [needsLockStatusRefresh, refreshLockStatus, unlocked]);

  const onSuccess = useCallback(() => {
    setVaultUnlocked(true);
    broadcastVaultWindowSync('unlock');
    setPassword('');
    setCode('');
    setSmsSent(false);
    setSelectedMethod(null);
    setStatusRefreshing(false);
  }, [setVaultUnlocked]);

  const handleWebAuthn = useCallback(async () => {
    await run(async () => {
      const options = await requestVaultWebAuthnOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      await unlockVaultWithWebAuthn(credential);
      onSuccess();
    }, 'WebAuthn authentication failed');
  }, [onSuccess, run]);

  useEffect(() => {
    if (unlocked) {
      autoWebAuthnTriggeredRef.current = false;
      return;
    }
    if (activeMethod !== 'webauthn' || !initialized || autoWebAuthnTriggeredRef.current) {
      return;
    }

    autoWebAuthnTriggeredRef.current = true;
    void handleWebAuthn();
  }, [activeMethod, handleWebAuthn, initialized, unlocked]);

  const handlePasswordSubmit = async () => {
    const ok = await run(async () => {
      await unlockVault(password);
    }, 'Failed to unlock vault');
    if (ok) {
      onSuccess();
    }
  };

  const handleTotpSubmit = async () => {
    const ok = await run(async () => {
      await unlockVaultWithTotp(code);
    }, 'Invalid TOTP code');
    if (ok) {
      onSuccess();
    }
  };

  const handleSmsRequest = async () => {
    const ok = await run(async () => {
      await requestVaultSmsCode();
    }, 'Failed to send SMS code');
    if (ok) {
      setSmsSent(true);
    }
  };

  const handleSmsSubmit = async () => {
    const ok = await run(async () => {
      await unlockVaultWithSms(code);
    }, 'Invalid or expired SMS code');
    if (ok) {
      onSuccess();
    }
  };

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // ignore logout API failures during forced sign-out
    }
    authLogout();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>, onSubmit: () => void) => {
    if (event.key === 'Enter' && !loading) {
      onSubmit();
    }
  };

  if (unlocked || !initialized) {
    return null;
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="w-[min(92vw,26rem)] gap-5 rounded-2xl border-border/80 bg-background p-6 shadow-2xl sm:max-w-md"
        overlayClassName="bg-black/55 backdrop-blur-sm"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <DialogTitle>Vault Locked</DialogTitle>
          <DialogDescription>
            {activeMethod !== 'password'
              ? 'Your vault was locked. Verify your identity to unlock.'
              : 'Your vault was locked due to inactivity timeout. Enter your password to unlock and resume.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="text-left">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {statusRefreshing && <LoadingPanel message="Checking available unlock methods..." />}

        {!statusRefreshing && activeMethod === 'webauthn' && (
          loading ? (
            <LoadingPanel message="Waiting for your security key or passkey..." />
          ) : (
            <Button type="button" className="w-full gap-2" onClick={handleWebAuthn}>
              <Fingerprint className="size-4" />
              Retry Passkey
            </Button>
          )
        )}

        {!statusRefreshing && activeMethod === 'totp' && (
          <div className="space-y-3">
            <NumericCodeField
              id="vault-unlock-totp"
              autoFocus
              label="Authenticator code"
              value={code}
              onChange={setCode}
              onKeyDown={(event) => handleKeyDown(event, handleTotpSubmit)}
            />
            <Button
              type="button"
              className="w-full"
              disabled={loading || code.length < 6}
              onClick={handleTotpSubmit}
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </Button>
          </div>
        )}

        {!statusRefreshing && activeMethod === 'sms' && (
          <div className="space-y-3">
            {!smsSent ? (
              <Button
                type="button"
                className="w-full gap-2"
                disabled={loading}
                onClick={handleSmsRequest}
              >
                <MessageSquareText className="size-4" />
                {loading ? 'Sending...' : 'Send SMS Code'}
              </Button>
            ) : (
              <>
                <NumericCodeField
                  id="vault-unlock-sms"
                  autoFocus
                  label="SMS code"
                  value={code}
                  onChange={setCode}
                  onKeyDown={(event) => handleKeyDown(event, handleSmsSubmit)}
                />
                <Button
                  type="button"
                  className="w-full"
                  disabled={loading || code.length < 6}
                  onClick={handleSmsSubmit}
                >
                  {loading ? 'Verifying...' : 'Verify Code'}
                </Button>
              </>
            )}
          </div>
        )}

        {!statusRefreshing && activeMethod === 'password' && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="vault-unlock-password">Password</Label>
              <Input
                id="vault-unlock-password"
                autoFocus
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, handlePasswordSubmit)}
              />
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={loading}
              onClick={handlePasswordSubmit}
            >
              {loading ? 'Unlocking...' : 'Unlock Vault'}
            </Button>
          </div>
        )}

        {!statusRefreshing && otherMethods.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5 text-center">
              {otherMethods.map((method) => (
                <Button
                  key={method}
                  type="button"
                  variant="link"
                  className="h-auto justify-center gap-2 px-0 py-1 text-sm font-normal"
                  onClick={() => handleMethodSelect(method)}
                >
                  {getMethodIcon(method)}
                  Use {getMethodLabel(method)} instead
                </Button>
              ))}
            </div>
          </>
        )}

        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground"
          onClick={handleLogout}
        >
          Logout
        </Button>
      </DialogContent>
    </Dialog>
  );
}
