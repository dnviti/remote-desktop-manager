import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant } from '../middleware/tenant.middleware';
import { identityVerificationLimiter } from '../middleware/identityRateLimit.middleware';
import { validate } from '../middleware/validate.middleware';
import { createRateLimiter } from '../middleware/rateLimitFactory';
import {
  updateProfileSchema, changePasswordSchema, initiateEmailChangeSchema,
  confirmEmailChangeSchema, initiateIdentitySchema, confirmIdentitySchema,
  uploadAvatarSchema, userSearchSchema, updateDomainProfileSchema,
} from '../schemas/user.schemas';
import { sshTerminalConfigSchema, rdpSettingsSchema } from '../schemas/common.schemas';
import * as userController from '../controllers/user.controller';
import { asyncHandler } from '../middleware/asyncHandler';

const userSearchRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  message: 'Too many search requests, please try again later',
  keyPrefix: 'user-search',
});

const router = Router();

router.use(authenticate);

router.get('/search', requireTenant, userSearchRateLimiter, validate(userSearchSchema, 'query'), asyncHandler(userController.search));
router.get('/profile', asyncHandler(userController.getProfile));
router.put('/profile', validate(updateProfileSchema), asyncHandler(userController.updateProfile));
router.put('/password', validate(changePasswordSchema), asyncHandler(userController.changePassword));
router.put('/ssh-defaults', validate(sshTerminalConfigSchema), asyncHandler(userController.updateSshDefaults));
router.put('/rdp-defaults', validate(rdpSettingsSchema), asyncHandler(userController.updateRdpDefaults));
router.post('/avatar', validate(uploadAvatarSchema), asyncHandler(userController.uploadAvatar));
router.get('/domain-profile', asyncHandler(userController.getDomainProfile));
router.put('/domain-profile', validate(updateDomainProfileSchema), asyncHandler(userController.updateDomainProfile));
router.delete('/domain-profile', asyncHandler(userController.clearDomainProfile));

// Identity verification & sensitive operations
router.post('/email-change/initiate', identityVerificationLimiter, validate(initiateEmailChangeSchema), asyncHandler(userController.initiateEmailChange));
router.post('/email-change/confirm', validate(confirmEmailChangeSchema), asyncHandler(userController.confirmEmailChange));
router.post('/password-change/initiate', identityVerificationLimiter, asyncHandler(userController.initiatePasswordChange));
router.post('/identity/initiate', identityVerificationLimiter, validate(initiateIdentitySchema), asyncHandler(userController.initiateIdentity));
router.post('/identity/confirm', validate(confirmIdentitySchema), asyncHandler(userController.confirmIdentity));

export default router;
