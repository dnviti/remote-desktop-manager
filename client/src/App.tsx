import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import ConnectionViewerPage from './pages/ConnectionViewerPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import VaultSetupPage from './pages/VaultSetupPage';
import PublicSharePage from './pages/PublicSharePage';
import VaultLockedOverlay from './components/Overlays/VaultLockedOverlay';
import { useAuth } from './hooks/useAuth';
import { useAuthStore } from './store/authStore';
import { useVaultStore } from './store/vaultStore';

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

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;
    checkStatus();
    startPolling();
    return () => stopPolling();
  }, [isAuthenticated, accessToken, checkStatus, startPolling, stopPolling]);

  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.vaultSetupComplete === false) return <Navigate to="/oauth/vault-setup" replace />;

  return (
    <>
      {children}
      <VaultLockedOverlay />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
  );
}
