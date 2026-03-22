import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRoleAny } from '../middleware/tenant.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import * as dbAuditController from '../controllers/dbAudit.controller';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(requireTenantRoleAny('ADMIN', 'OWNER', 'AUDITOR'));

// DB Audit Logs
router.get('/logs', asyncHandler(dbAuditController.listDbAuditLogs));
router.get('/logs/connections', asyncHandler(dbAuditController.listDbAuditConnections));
router.get('/logs/users', asyncHandler(dbAuditController.listDbAuditUsers));

// Firewall Rules (ADMIN/OWNER only for mutations)
router.get('/firewall-rules', asyncHandler(dbAuditController.listFirewallRules));
router.get('/firewall-rules/:ruleId', asyncHandler(dbAuditController.getFirewallRule));
router.post('/firewall-rules', requireTenantRoleAny('ADMIN', 'OWNER'), asyncHandler(dbAuditController.createFirewallRule));
router.put('/firewall-rules/:ruleId', requireTenantRoleAny('ADMIN', 'OWNER'), asyncHandler(dbAuditController.updateFirewallRule));
router.delete('/firewall-rules/:ruleId', requireTenantRoleAny('ADMIN', 'OWNER'), asyncHandler(dbAuditController.deleteFirewallRule));

// Masking Policies (ADMIN/OWNER only for mutations)
router.get('/masking-policies', asyncHandler(dbAuditController.listMaskingPolicies));
router.get('/masking-policies/:policyId', asyncHandler(dbAuditController.getMaskingPolicy));
router.post('/masking-policies', requireTenantRoleAny('ADMIN', 'OWNER'), asyncHandler(dbAuditController.createMaskingPolicy));
router.put('/masking-policies/:policyId', requireTenantRoleAny('ADMIN', 'OWNER'), asyncHandler(dbAuditController.updateMaskingPolicy));
router.delete('/masking-policies/:policyId', requireTenantRoleAny('ADMIN', 'OWNER'), asyncHandler(dbAuditController.deleteMaskingPolicy));

export default router;
