import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import * as sessionController from '../controllers/session.controller';

const router = Router();

router.use(authenticate);

// RDP session lifecycle (for the session owner)
router.post('/rdp', sessionController.createRdpSession);
router.post('/rdp/:sessionId/heartbeat', sessionController.rdpHeartbeat);
router.post('/rdp/:sessionId/end', sessionController.rdpEnd);

// SSH session validation (existing, unchanged)
router.post('/ssh', sessionController.validateSshAccess);

// Admin: active session monitoring
router.get('/active', requireTenant, requireTenantRole('ADMIN'), sessionController.listActiveSessions);
router.get('/count', requireTenant, requireTenantRole('ADMIN'), sessionController.getSessionCount);
router.get('/count/gateway', requireTenant, requireTenantRole('ADMIN'), sessionController.getSessionCountByGateway);
router.post('/:sessionId/terminate', requireTenant, requireTenantRole('ADMIN'), sessionController.terminateSession);

export default router;
