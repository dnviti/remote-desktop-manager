import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { auditQuerySchema, tenantAuditQuerySchema, connectionIdSchema, connectionAuditQuerySchema } from '../schemas/audit.schemas';
import * as auditController from '../controllers/audit.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);
router.get('/tenant/gateways', requireTenant, requireTenantRole('ADMIN'), asyncHandler(auditController.listTenantGateways));
router.get('/tenant/countries', requireTenant, requireTenantRole('ADMIN'), asyncHandler(auditController.listTenantCountries));
router.get('/tenant/geo-summary', requireTenant, requireTenantRole('ADMIN'), asyncHandler(auditController.getTenantGeoSummary));
router.get('/tenant', requireTenant, requireTenantRole('ADMIN'), validate(tenantAuditQuerySchema, 'query'), asyncHandler(auditController.listTenantLogs));
router.get('/connection/:connectionId/users', validate(connectionIdSchema, 'params'), asyncHandler(auditController.listConnectionAuditUsers));
router.get('/connection/:connectionId', validate({ params: connectionIdSchema, query: connectionAuditQuerySchema }), asyncHandler(auditController.listConnectionLogs));
router.get('/countries', asyncHandler(auditController.listCountries));
router.get('/gateways', asyncHandler(auditController.listGateways));
router.get('/', validate(auditQuerySchema, 'query'), asyncHandler(auditController.list));

export default router;
