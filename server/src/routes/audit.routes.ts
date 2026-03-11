import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import { validate } from '../middleware/validate.middleware';
import { auditQuerySchema, tenantAuditQuerySchema, connectionIdSchema, connectionAuditQuerySchema } from '../schemas/audit.schemas';
import * as auditController from '../controllers/audit.controller';

const router = Router();

router.use(authenticate);
router.get('/tenant/gateways', requireTenant, requireTenantRole('ADMIN'), auditController.listTenantGateways);
router.get('/tenant/countries', requireTenant, requireTenantRole('ADMIN'), auditController.listTenantCountries);
router.get('/tenant/geo-summary', requireTenant, requireTenantRole('ADMIN'), auditController.getTenantGeoSummary);
router.get('/tenant', requireTenant, requireTenantRole('ADMIN'), validate(tenantAuditQuerySchema, 'query'), auditController.listTenantLogs);
router.get('/connection/:connectionId/users', validate(connectionIdSchema, 'params'), auditController.listConnectionAuditUsers);
router.get('/connection/:connectionId', validate(connectionIdSchema, 'params'), validate(connectionAuditQuerySchema, 'query'), auditController.listConnectionLogs);
router.get('/countries', auditController.listCountries);
router.get('/gateways', auditController.listGateways);
router.get('/', validate(auditQuerySchema, 'query'), auditController.list);

export default router;
