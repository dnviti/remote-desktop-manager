import express from 'express';
import cors from 'cors';
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
import filesRoutes from './routes/files.routes';
import auditRoutes from './routes/audit.routes';
import notificationRoutes from './routes/notification.routes';
import tenantRoutes from './routes/tenant.routes';
import { errorHandler } from './middleware/error.middleware';
import { initializePassport } from './config/passport';

const app = express();

app.use(cors({ origin: ['http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '500kb' }));
app.use(passport.initialize());
initializePassport();

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
app.use('/api/files', filesRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tenants', tenantRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Error handler
app.use(errorHandler);

export default app;
