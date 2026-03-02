import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import passport from 'passport';
import authRoutes from './routes/auth.routes';
import oauthRoutes from './routes/oauth.routes';
import vaultRoutes from './routes/vault.routes';
import connectionsRoutes from './routes/connections.routes';
import foldersRoutes from './routes/folders.routes';
import sharingRoutes from './routes/sharing.routes';
import sessionsRoutes from './socket/rdp.handler';
import userRoutes from './routes/user.routes';
import twofaRoutes from './routes/twofa.routes';
import smsMfaRoutes from './routes/smsMfa.routes';
import filesRoutes from './routes/files.routes';
import auditRoutes from './routes/audit.routes';
import notificationRoutes from './routes/notification.routes';
import tenantRoutes from './routes/tenant.routes';
import teamRoutes from './routes/team.routes';
import adminRoutes from './routes/admin.routes';
import gatewayRoutes from './routes/gateway.routes';
import tabsRoutes from './routes/tabs.routes';
import healthRoutes from './routes/health.routes';
import { errorHandler } from './middleware/error.middleware';

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
app.use(cors({ origin: ['http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '500kb' }));
app.use(passport.initialize());

// Routes
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
app.use('/api/files', filesRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/gateways', gatewayRoutes);
app.use('/api/tabs', tabsRoutes);

// Health & readiness probes
app.use('/api', healthRoutes);

// Error handler
app.use(errorHandler);

export default app;
