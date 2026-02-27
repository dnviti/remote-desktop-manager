import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole, requireOwnTenant } from '../middleware/tenant.middleware';
import * as tenantController from '../controllers/tenant.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Create tenant (any authenticated user without a tenant)
router.post('/', tenantController.createTenant);

// Get my tenant details (requires tenant membership)
router.get('/mine', requireTenant, tenantController.getMyTenant);

// Tenant-specific routes (require tenant + own tenant check)
router.put('/:id', requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), tenantController.updateTenant);
router.delete('/:id', requireTenant, requireOwnTenant, requireTenantRole('OWNER'), tenantController.deleteTenant);

// User management within tenant
router.get('/:id/users', requireTenant, requireOwnTenant, tenantController.listUsers);
router.post('/:id/invite', requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), tenantController.inviteUser);
router.put('/:id/users/:userId', requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), tenantController.updateUserRole);
router.delete('/:id/users/:userId', requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), tenantController.removeUser);

export default router;
