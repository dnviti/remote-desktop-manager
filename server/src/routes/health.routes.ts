import { Router, Request, Response } from 'express';
import {
  isServerReady,
  checkDatabase,
  checkGuacd,
} from '../services/health.service';
import { checkRequiredGateways, type GatewayHealthStatus } from '../services/gatewayHealth.service';
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
      status: 'unavailable',
      reason: 'Server still initializing',
    });
    return;
  }

  const db = await checkDatabase();
  const guacd = await checkGuacd();

  // Short-circuit gateway checks when DB is down — checkRequiredGateways
  // uses Prisma queries that would throw on a dead connection.
  let gatewayCheck: { allAvailable: boolean; missing: string[]; details: GatewayHealthStatus | { error: string } };

  if (!db.ok) {
    gatewayCheck = {
      allAvailable: false,
      missing: [],
      details: { error: 'Gateway checks skipped because database is unavailable' },
    };
  } else {
    try {
      gatewayCheck = await checkRequiredGateways(config.gatewayRequiredTypes);
    } catch (err) {
      gatewayCheck = {
        allAvailable: false,
        missing: [],
        details: {
          error: err instanceof Error ? err.message : 'Failed to check gateway health',
        },
      };
    }
  }

  let status: 'ok' | 'unavailable' = db.ok ? 'ok' : 'unavailable';

  // Gateways are always mandatory — missing gateways means server cannot serve connections
  if (db.ok && !gatewayCheck.allAvailable) {
    status = 'unavailable';
  }

  const httpStatus = status === 'unavailable' ? 503 : 200;

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
