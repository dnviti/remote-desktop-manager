import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole, requireOwnTenant } from '../middleware/tenant.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import {
  createTenantSchema, updateTenantSchema, inviteUserSchema, updateRoleSchema,
  createUserSchema, toggleUserEnabledSchema, adminChangeEmailSchema, adminChangePasswordSchema,
} from '../schemas/tenant.schemas';
import * as tenantController from '../controllers/tenant.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Create tenant (any authenticated user without a tenant)
router.post('/', validate(createTenantSchema), tenantController.createTenant);

// List all tenants the user belongs to
router.get('/mine/all', tenantController.listMyTenants);

// Get my tenant details (requires tenant membership)
router.get('/mine', requireTenant, tenantController.getMyTenant);

// Tenant-specific routes (require tenant + own tenant check)
router.put('/:id', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validate(updateTenantSchema), tenantController.updateTenant);
router.delete('/:id', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('OWNER'), tenantController.deleteTenant);

// MFA policy stats
router.get('/:id/mfa-stats', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), tenantController.getMfaStats);

// User management within tenant
router.get('/:id/users', validateUuidParam(), requireTenant, requireOwnTenant, tenantController.listUsers);
router.get('/:id/users/:userId/profile', validateUuidParam(), requireTenant, requireOwnTenant, validateUuidParam('userId'), tenantController.getUserProfile);
router.post('/:id/invite', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validate(inviteUserSchema), tenantController.inviteUser);
router.put('/:id/users/:userId', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(updateRoleSchema), tenantController.updateUserRole);
router.delete('/:id/users/:userId', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), tenantController.removeUser);
router.post('/:id/users', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validate(createUserSchema), tenantController.createUser);
router.patch('/:id/users/:userId/enabled', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(toggleUserEnabledSchema), tenantController.toggleUserEnabled);

// Admin identity-verified operations on users
router.put('/:id/users/:userId/email', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(adminChangeEmailSchema), tenantController.adminChangeUserEmail);
router.put('/:id/users/:userId/password', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(adminChangePasswordSchema), tenantController.adminChangeUserPassword);

export default router;
