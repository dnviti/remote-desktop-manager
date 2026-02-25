import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes';
import vaultRoutes from './routes/vault.routes';
import connectionsRoutes from './routes/connections.routes';
import foldersRoutes from './routes/folders.routes';
import sharingRoutes from './routes/sharing.routes';
import sessionsRoutes from './socket/rdp.handler';
import { errorHandler } from './middleware/error.middleware';

const app = express();

app.use(cors({ origin: ['http://localhost:3000'], credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/folders', foldersRoutes);
app.use('/api/connections', sharingRoutes);
app.use('/api/sessions', sessionsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Error handler
app.use(errorHandler);

export default app;
