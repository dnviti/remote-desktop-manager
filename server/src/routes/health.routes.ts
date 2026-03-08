import { Router, Request, Response } from 'express';
import {
  isServerReady,
  checkDatabase,
  checkGuacd,
} from '../services/health.service';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

router.get('/ready', async (_req: Request, res: Response) => {
  if (!isServerReady()) {
    res.status(503).json({
      status: 'not_ready',
      reason: 'Server still initializing',
    });
    return;
  }

  const db = await checkDatabase();
  const guacd = await checkGuacd();

  const ready = db.ok;

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks: { database: db, guacd },
  });
});

export default router;
