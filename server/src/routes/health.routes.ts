import { Router, Request, Response } from 'express';
import {
  isServerReady,
  checkDatabase,
  checkGuacd,
} from '../services/health.service';
import { checkRequiredGateways } from '../services/gatewayHealth.service';
import { config } from '../config';

const router = Router();

/* eslint-disable @typescript-eslint/no-require-imports */
const { version } = require('../../package.json') as { version: string };
/* eslint-enable @typescript-eslint/no-require-imports */

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version });
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
  const gatewayCheck = await checkRequiredGateways(config.gatewayRequiredTypes);

  let status: 'ready' | 'degraded' | 'unavailable' = db.ok ? 'ready' : 'unavailable';

  if (db.ok && !gatewayCheck.allAvailable) {
    if (config.gatewayRoutingMode === 'gateway-mandatory') {
      status = 'unavailable';
    } else {
      status = 'degraded';
    }
  }

  const httpStatus = status === 'unavailable' || !db.ok ? 503 : 200;

  res.status(httpStatus).json({
    status,
    checks: {
      database: db,
      guacd,
      gateways: {
        mode: config.gatewayRoutingMode,
        ...gatewayCheck.details,
      },
    },
  });
});

export default router;
