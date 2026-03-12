import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole, requireTenantRoleAny } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { sessionRateLimiter } from '../middleware/sessionRateLimit.middleware';
import { sessionSchema } from '../schemas/session.schemas';
import * as sessionController from '../controllers/session.controller';

const router = Router();

router.use(authenticate);

// RDP session lifecycle (for the session owner)
router.post('/rdp', sessionRateLimiter, validate(sessionSchema), asyncHandler(sessionController.createRdpSession));
router.post('/rdp/:sessionId/heartbeat', asyncHandler(sessionController.rdpHeartbeat));
router.post('/rdp/:sessionId/end', asyncHandler(sessionController.rdpEnd));

// VNC session lifecycle (same pattern as RDP, both use guacamole-lite)
router.post('/vnc', sessionRateLimiter, validate(sessionSchema), asyncHandler(sessionController.createVncSession));
router.post('/vnc/:sessionId/heartbeat', asyncHandler(sessionController.rdpHeartbeat));
router.post('/vnc/:sessionId/end', asyncHandler(sessionController.rdpEnd));

// SSH session validation (existing, unchanged)
router.post('/ssh', sessionRateLimiter, validate(sessionSchema), asyncHandler(sessionController.validateSshAccess));

// Admin: active session monitoring
router.get('/active', requireTenant, requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR', 'OPERATOR'), asyncHandler(sessionController.listActiveSessions));
router.get('/count', requireTenant, requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR', 'OPERATOR'), asyncHandler(sessionController.getSessionCount));
router.get('/count/gateway', requireTenant, requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR', 'OPERATOR'), asyncHandler(sessionController.getSessionCountByGateway));
router.post('/:sessionId/terminate', requireTenant, requireTenantRole('ADMIN'), asyncHandler(sessionController.terminateSession));

export default router;
