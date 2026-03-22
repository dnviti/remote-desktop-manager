import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import ConnectionViewerPage from './pages/ConnectionViewerPage';
import RecordingPlayerPage from './pages/RecordingPlayerPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import VaultSetupPage from './pages/VaultSetupPage';
import PublicSharePage from './pages/PublicSharePage';
import SetupWizardPage from './pages/SetupWizardPage';
import VaultLockedOverlay from './components/Overlays/VaultLockedOverlay';
import PwaUpdateNotification from './components/common/PwaUpdateNotification';
import { useAuth } from './hooks/useAuth';
import { useAuthStore } from './store/authStore';
import { useVaultStore } from './store/vaultStore';
import { getSetupStatus } from './api/setup.api';

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const checkStatus = useVaultStore((s) => s.checkStatus);
  const startPolling = useVaultStore((s) => s.startPolling);
  const stopPolling = useVaultStore((s) => s.stopPolling);
  const location = useLocation();

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;
    checkStatus();
    startPolling();
    return () => stopPolling();
  }, [isAuthenticated, accessToken, checkStatus, startPolling, stopPolling]);

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
  return (
    <>
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
              <RecordingPlayerPage />
            </ProtectedRoute>
          }
        />
        <Route path="/share/:token" element={<PublicSharePage />} />
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
    </>
  );
}
