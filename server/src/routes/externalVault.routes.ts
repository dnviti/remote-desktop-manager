import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant, requireTenantRole } from '../middleware/tenant.middleware';
import { validate, validateUuidParam } from '../middleware/validate.middleware';
import {
  createVaultProviderSchema,
  updateVaultProviderSchema,
  testVaultProviderSchema,
} from '../schemas/externalVault.schemas';
import * as externalVaultController from '../controllers/externalVault.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

// All routes require authentication + tenant + ADMIN role
router.use(authenticate, requireTenant, requireTenantRole('ADMIN'));

// List all providers for the tenant
router.get('/', asyncHandler(externalVaultController.listProviders));

// Create a new provider
router.post('/', validate(createVaultProviderSchema), asyncHandler(externalVaultController.createProvider));

// Get a single provider
router.get('/:providerId', validateUuidParam('providerId'), asyncHandler(externalVaultController.getProvider));

// Update a provider
router.put('/:providerId', validateUuidParam('providerId'), validate(updateVaultProviderSchema), asyncHandler(externalVaultController.updateProvider));

// Delete a provider
router.delete('/:providerId', validateUuidParam('providerId'), asyncHandler(externalVaultController.deleteProvider));

// Test connectivity to a secret path
router.post('/:providerId/test', validateUuidParam('providerId'), validate(testVaultProviderSchema), asyncHandler(externalVaultController.testProvider));

export default router;
