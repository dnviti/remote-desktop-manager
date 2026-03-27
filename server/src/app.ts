import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import authRoutes from './routes/auth.routes';
import oauthRoutes from './routes/oauth.routes';
import samlRoutes from './routes/saml.routes';
import vaultRoutes from './routes/vault.routes';
import connectionsRoutes from './routes/connections.routes';
import foldersRoutes from './routes/folders.routes';
import sharingRoutes from './routes/sharing.routes';
import sessionsRoutes from './routes/session.routes';
import userRoutes from './routes/user.routes';
import twofaRoutes from './routes/twofa.routes';
import smsMfaRoutes from './routes/smsMfa.routes';
import webauthnRoutes from './routes/webauthn.routes';
import filesRoutes from './routes/files.routes';
import auditRoutes from './routes/audit.routes';
import notificationRoutes from './routes/notification.routes';
import tenantRoutes from './routes/tenant.routes';
import teamRoutes from './routes/team.routes';
import adminRoutes from './routes/admin.routes';
import gatewayRoutes from './routes/gateway.routes';
import tabsRoutes from './routes/tabs.routes';
import secretRoutes from './routes/secret.routes';
import vaultFoldersRoutes from './routes/vault-folders.routes';
import publicShareRoutes from './routes/publicShare.routes';
import recordingRoutes from './routes/recording.routes';
import importExportRoutes from './routes/importExport.routes';
import geoipRoutes from './routes/geoip.routes';
import ldapRoutes from './routes/ldap.routes';
import syncRoutes from './routes/sync.routes';
import externalVaultRoutes from './routes/externalVault.routes';
import accessPolicyRoutes from './routes/accessPolicy.routes';
import checkoutRoutes from './routes/checkout.routes';
import sshProxyRoutes from './routes/sshProxy.routes';
import rdGatewayRoutes from './routes/rdGateway.routes';
import cliRoutes from './routes/cli.routes';
import dbProxyRoutes from './routes/dbProxy.routes';
import dbAuditRoutes from './routes/dbAudit.routes';
import passwordRotationRoutes from './routes/passwordRotation.routes';
import dbTunnelRoutes from './routes/dbTunnel.routes';
import keystrokePolicyRoutes from './routes/keystrokePolicy.routes';
import aiQueryRoutes from './routes/aiQuery.routes';
import systemSettingsRoutes from './routes/systemSettings.routes';
import setupRoutes from './routes/setup.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/requestLogger.middleware';
import { validateCsrf } from './middleware/csrf.middleware';
import { globalRateLimit } from './middleware/globalRateLimit.middleware';
import { config } from './config';
import { requireFeature } from './middleware/featureGate.middleware';

const app = express();

// Feature gate middleware instances (read config at request time for live reload)
const dbProxyGate = requireFeature(() => config.features.databaseProxyEnabled, 'Database SQL Proxy');
const connectionsGate = requireFeature(() => config.features.connectionsEnabled, 'Connection Management');
const connectionsOrDbGate = requireFeature(
  () => config.features.connectionsEnabled || config.features.databaseProxyEnabled,
  'Connection Management',
);
const keychainGate = requireFeature(() => config.features.keychainEnabled, 'Keychain');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
// Permissions-Policy header (not included in Helmet by default)
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()');
  next();
});
if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

// Host header validation — prevent DNS rebinding / cache poisoning
if (config.hostValidationEnabled) {
  const allowedHostname = (() => {
    try { return new URL(config.clientUrl).hostname; } catch { return ''; }
  })();
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  app.use((req, res, next) => {
    const host = (req.hostname || req.get('host') || '').replace(/:\d+$/, '');
    if (!host || host === allowedHostname || localHosts.has(host)) return next();
    res.status(400).json({ error: 'Invalid Host header' });
  });
}
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin === config.clientUrl) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: '500kb' }));
app.use(cookieParser()); // codeql[js/missing-token-validation] CSRF validated by custom double-submit-cookie middleware at lines 98-105
app.use(passport.initialize());
app.use((req, res, next) => {
  if (config.logHttpRequests) return requestLogger(req, res, next);
  next();
});

// Global CSRF validation for all state-changing requests (after CORS, before routes)
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const csrfExemptPaths = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/auth/verify-email', '/auth/verify-totp', '/auth/request-sms-code', '/auth/verify-sms', '/auth/request-webauthn-options', '/auth/verify-webauthn', '/auth/mfa-setup/', '/auth/resend-verification', '/auth/saml', '/auth/config', '/auth/oauth/exchange-code', '/share', '/cli/auth/device', '/setup'];
  // Use exact match or subpath match (path + '/') to prevent prefix collisions
  // e.g., '/auth/login' must not exempt '/auth/login-history'
  if (csrfExemptPaths.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();
  return validateCsrf(req, res, next);
});

// Global rate limit for all /api routes. JWT peek is inlined in the rate
// limiter's keyGenerator so CodeQL sees auth + rate limiting in one handler.
app.use('/api', globalRateLimit);

// Routes
app.use('/api/setup', setupRoutes);
app.use('/api/auth/saml', samlRoutes);
app.use('/api/auth', oauthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/connections', connectionsOrDbGate, connectionsRoutes);
app.use('/api/folders', connectionsOrDbGate, foldersRoutes);
app.use('/api/connections', connectionsOrDbGate, sharingRoutes);
app.use('/api/sessions/db-tunnel', dbProxyGate, dbTunnelRoutes);
app.use('/api/sessions', connectionsGate, sessionsRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user/2fa', twofaRoutes);
app.use('/api/user/2fa/sms', smsMfaRoutes);
app.use('/api/user/2fa/webauthn', webauthnRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/gateways', gatewayRoutes);
app.use('/api/tabs', tabsRoutes);
app.use('/api/secrets', keychainGate, secretRoutes);
app.use('/api/vault-folders', keychainGate, vaultFoldersRoutes);
app.use('/api/share', publicShareRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/connections', connectionsOrDbGate, importExportRoutes);
app.use('/api/geoip', geoipRoutes);
app.use('/api/ldap', ldapRoutes);
app.use('/api/sync-profiles', syncRoutes);
app.use('/api/vault-providers', externalVaultRoutes);
app.use('/api/access-policies', accessPolicyRoutes);
app.use('/api/checkouts', checkoutRoutes);
app.use('/api/sessions/ssh-proxy', connectionsGate, sshProxyRoutes);
app.use('/api/rdgw', rdGatewayRoutes);
app.use('/api/cli', cliRoutes);
app.use('/api/sessions/database', dbProxyGate, dbProxyRoutes);
app.use('/api/db-audit', dbProxyGate, dbAuditRoutes);
app.use('/api/secrets', keychainGate, passwordRotationRoutes);
app.use('/api/keystroke-policies', keystrokePolicyRoutes);
app.use('/api/ai', dbProxyGate, aiQueryRoutes);
app.use('/api/admin/system-settings', systemSettingsRoutes);

// Health & readiness probes
app.use('/api', healthRoutes);

// Custom 404 handler for API routes (prevents framework disclosure)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use(errorHandler);

export default app;
