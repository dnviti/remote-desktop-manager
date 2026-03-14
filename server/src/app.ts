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
import healthRoutes from './routes/health.routes';
import { errorHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/requestLogger.middleware';
import { config } from './config';

const app = express();

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
if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
app.use(cors({ origin: [config.clientUrl], credentials: true }));
app.use(express.json({ limit: '500kb' }));
app.use(cookieParser());
app.use(passport.initialize());
if (config.logHttpRequests) app.use(requestLogger);

// Routes
app.use('/api/auth/saml', samlRoutes);
app.use('/api/auth', oauthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/folders', foldersRoutes);
app.use('/api/connections', sharingRoutes);
app.use('/api/sessions', sessionsRoutes);
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
app.use('/api/secrets', secretRoutes);
app.use('/api/vault-folders', vaultFoldersRoutes);
app.use('/api/share', publicShareRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/connections', importExportRoutes);
app.use('/api/geoip', geoipRoutes);
app.use('/api/ldap', ldapRoutes);
app.use('/api/sync-profiles', syncRoutes);
app.use('/api/vault-providers', externalVaultRoutes);

// Health & readiness probes
app.use('/api', healthRoutes);

// Error handler
app.use(errorHandler);

export default app;
