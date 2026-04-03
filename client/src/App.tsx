import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import VaultLockedOverlay from './components/Overlays/VaultLockedOverlay';
import PwaUpdateNotification from './components/common/PwaUpdateNotification';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ConnectionViewerPage = lazy(() => import('./pages/ConnectionViewerPage'));
const RecordingPlayerPage = lazy(() => import('./pages/RecordingPlayerPage'));
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage'));
const VaultSetupPage = lazy(() => import('./pages/VaultSetupPage'));
const PublicSharePage = lazy(() => import('./pages/PublicSharePage'));
const SetupWizardPage = lazy(() => import('./pages/SetupWizardPage'));

function LazyFallback() {
  return (
    <Box sx={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>
  );
}
import { useAuth } from './hooks/useAuth';
import { useAuthStore } from './store/authStore';
import { useVaultStatusStream } from './hooks/useVaultStatusStream';
import { getSetupStatus } from './api/setup.api';
import { useFeatureFlagsStore } from './store/featureFlagsStore';

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  useVaultStatusStream();

  if (loading) return null;
  if (!isAuthenticated) {
    // Preserve query params (e.g. autoconnect) when redirecting to login
    const loginTarget = location.search ? `/login${location.search}` : '/login';
    return <Navigate to={loginTarget} replace />;
  }
  if (user?.vaultSetupComplete === false) return <Navigate to="/oauth/vault-setup" replace />;

  return (
    <>
      {children}
      <VaultLockedOverlay />
    </>
  );
}

/**
 * Redirects to /setup if setup is required (zero users in DB).
 * Wraps public routes like /login and /register.
 */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    getSetupStatus()
      .then((s) => setSetupRequired(s.required))
      .catch(() => { /* fail-open: server guard is authoritative */ })
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (setupRequired) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export default function App() {
  const recordingsEnabled = useFeatureFlagsStore((s) => s.recordingsEnabled);
  const sharingApprovalsEnabled = useFeatureFlagsStore((s) => s.sharingApprovalsEnabled);

  return (
    <Suspense fallback={<LazyFallback />}>
      <Routes>
        <Route path="/setup" element={<SetupWizardPage />} />
        <Route path="/login" element={<SetupGuard><LoginPage /></SetupGuard>} />
        <Route path="/register" element={<SetupGuard><RegisterPage /></SetupGuard>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route
          path="/oauth/vault-setup"
          element={
            <AuthRoute>
              <VaultSetupPage />
            </AuthRoute>
          }
        />
        <Route
          path="/connection/:id"
          element={
            <ProtectedRoute>
              <ConnectionViewerPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recording/:id"
          element={
            <ProtectedRoute>
              {recordingsEnabled ? <RecordingPlayerPage /> : <Navigate to="/" replace />}
            </ProtectedRoute>
          }
        />
        <Route path="/share/:token" element={sharingApprovalsEnabled ? <PublicSharePage /> : <Navigate to="/" replace />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
      </Routes>
      <PwaUpdateNotification />
    </Suspense>
  );
}
