import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRoleAny } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { auditQuerySchema, tenantAuditQuerySchema, connectionIdSchema, connectionAuditQuerySchema } from '../schemas/audit.schemas';
import * as auditController from '../controllers/audit.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);
router.get('/tenant/gateways', requireTenant, requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR'), asyncHandler(auditController.listTenantGateways));
router.get('/tenant/countries', requireTenant, requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR'), asyncHandler(auditController.listTenantCountries));
router.get('/tenant/geo-summary', requireTenant, requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR'), asyncHandler(auditController.getTenantGeoSummary));
router.get('/tenant', requireTenant, requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR'), validate(tenantAuditQuerySchema, 'query'), asyncHandler(auditController.listTenantLogs));
router.get('/connection/:connectionId/users', validate(connectionIdSchema, 'params'), asyncHandler(auditController.listConnectionAuditUsers));
router.get('/connection/:connectionId', validate({ params: connectionIdSchema, query: connectionAuditQuerySchema }), asyncHandler(auditController.listConnectionLogs));
router.get('/countries', asyncHandler(auditController.listCountries));
router.get('/gateways', asyncHandler(auditController.listGateways));
router.get('/', validate(auditQuerySchema, 'query'), asyncHandler(auditController.list));

export default router;
