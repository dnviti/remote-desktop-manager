import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import * as auditController from '../controllers/audit.controller';

const router = Router();

router.use(authenticate);
router.get('/tenant/gateways', requireTenant, requireTenantRole('ADMIN'), auditController.listTenantGateways);
router.get('/tenant/countries', requireTenant, requireTenantRole('ADMIN'), auditController.listTenantCountries);
router.get('/tenant/geo-summary', requireTenant, requireTenantRole('ADMIN'), auditController.getTenantGeoSummary);
router.get('/tenant', requireTenant, requireTenantRole('ADMIN'), auditController.listTenantLogs);
router.get('/connection/:connectionId/users', auditController.listConnectionAuditUsers);
router.get('/connection/:connectionId', auditController.listConnectionLogs);
router.get('/countries', auditController.listCountries);
router.get('/gateways', auditController.listGateways);
router.get('/', auditController.list);

export default router;
