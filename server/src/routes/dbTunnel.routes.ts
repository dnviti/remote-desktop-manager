import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { sessionRateLimiter } from '../middleware/sessionRateLimit.middleware';
import { dbTunnelSchema } from '../schemas/dbTunnel.schemas';
import * as dbTunnelController from '../controllers/dbTunnel.controller';

const router = Router();

router.use(authenticate);

// Open a new DB tunnel
router.post('/', sessionRateLimiter, validate(dbTunnelSchema), asyncHandler(dbTunnelController.createDbTunnel));

// List active tunnels for the current user
router.get('/', asyncHandler(dbTunnelController.listDbTunnels));

// Heartbeat for a tunnel
router.post('/:tunnelId/heartbeat', asyncHandler(dbTunnelController.dbTunnelHeartbeat));

// Close a tunnel
router.delete('/:tunnelId', asyncHandler(dbTunnelController.closeDbTunnel));

export default router;
