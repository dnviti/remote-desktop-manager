import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole, requireOwnTenant } from '../middleware/tenant.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import {
  createTenantSchema, updateTenantSchema, inviteUserSchema, updateRoleSchema,
  createUserSchema, toggleUserEnabledSchema, adminChangeEmailSchema, adminChangePasswordSchema,
  updateMembershipExpirySchema, ipAllowlistSchema,
} from '../schemas/tenant.schemas';
import * as tenantController from '../controllers/tenant.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Create tenant (any authenticated user without a tenant)
router.post('/', validate(createTenantSchema), asyncHandler(tenantController.createTenant));

// List all tenants the user belongs to
router.get('/mine/all', asyncHandler(tenantController.listMyTenants));

// Get my tenant details (requires tenant membership)
router.get('/mine', requireTenant, asyncHandler(tenantController.getMyTenant));

// Tenant-specific routes (require tenant + own tenant check)
router.put('/:id', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validate(updateTenantSchema), asyncHandler(tenantController.updateTenant));
router.delete('/:id', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('OWNER'), asyncHandler(tenantController.deleteTenant));

// MFA policy stats
router.get('/:id/mfa-stats', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), asyncHandler(tenantController.getMfaStats));

// User management within tenant
router.get('/:id/users', validateUuidParam(), requireTenant, requireOwnTenant, asyncHandler(tenantController.listUsers));
router.get('/:id/users/:userId/profile', validateUuidParam(), requireTenant, requireOwnTenant, validateUuidParam('userId'), asyncHandler(tenantController.getUserProfile));
router.post('/:id/invite', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validate(inviteUserSchema), asyncHandler(tenantController.inviteUser));
router.put('/:id/users/:userId', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(updateRoleSchema), asyncHandler(tenantController.updateUserRole));
router.delete('/:id/users/:userId', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), asyncHandler(tenantController.removeUser));
router.post('/:id/users', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validate(createUserSchema), asyncHandler(tenantController.createUser));
router.patch('/:id/users/:userId/enabled', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(toggleUserEnabledSchema), asyncHandler(tenantController.toggleUserEnabled));
router.patch('/:id/users/:userId/expiry', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(updateMembershipExpirySchema), asyncHandler(tenantController.updateMembershipExpiry));

// Admin identity-verified operations on users
router.put('/:id/users/:userId/email', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(adminChangeEmailSchema), asyncHandler(tenantController.adminChangeUserEmail));
router.put('/:id/users/:userId/password', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validateUuidParam('userId'), validate(adminChangePasswordSchema), asyncHandler(tenantController.adminChangeUserPassword));

// IP allowlist management (admin only)
router.get('/:id/ip-allowlist', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), asyncHandler(tenantController.getIpAllowlist));
router.put('/:id/ip-allowlist', validateUuidParam(), requireTenant, requireOwnTenant, requireTenantRole('ADMIN'), validate(ipAllowlistSchema), asyncHandler(tenantController.updateIpAllowlist));

export default router;
