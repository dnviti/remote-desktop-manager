import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { sessionSchema } from '../schemas/session.schemas';
import * as sessionController from '../controllers/session.controller';

const router = Router();

router.use(authenticate);

// RDP session lifecycle (for the session owner)
router.post('/rdp', validate(sessionSchema), sessionController.createRdpSession);
router.post('/rdp/:sessionId/heartbeat', sessionController.rdpHeartbeat);
router.post('/rdp/:sessionId/end', sessionController.rdpEnd);

// VNC session lifecycle (same pattern as RDP, both use guacamole-lite)
router.post('/vnc', validate(sessionSchema), sessionController.createVncSession);
router.post('/vnc/:sessionId/heartbeat', sessionController.rdpHeartbeat);
router.post('/vnc/:sessionId/end', sessionController.rdpEnd);

// SSH session validation (existing, unchanged)
router.post('/ssh', validate(sessionSchema), sessionController.validateSshAccess);

// Admin: active session monitoring
router.get('/active', requireTenant, requireTenantRole('ADMIN'), sessionController.listActiveSessions);
router.get('/count', requireTenant, requireTenantRole('ADMIN'), sessionController.getSessionCount);
router.get('/count/gateway', requireTenant, requireTenantRole('ADMIN'), sessionController.getSessionCountByGateway);
router.post('/:sessionId/terminate', requireTenant, requireTenantRole('ADMIN'), sessionController.terminateSession);

export default router;
