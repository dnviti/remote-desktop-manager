import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant } from '../middleware/tenant.middleware';
import { identityVerificationLimiter } from '../middleware/identityRateLimit.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  updateProfileSchema, changePasswordSchema, initiateEmailChangeSchema,
  confirmEmailChangeSchema, initiateIdentitySchema, confirmIdentitySchema,
  uploadAvatarSchema, userSearchSchema, updateDomainProfileSchema,
} from '../schemas/user.schemas';
import { sshTerminalConfigSchema, rdpSettingsSchema } from '../schemas/common.schemas';
import * as userController from '../controllers/user.controller';

const router = Router();

router.use(authenticate);

router.get('/search', requireTenant, validate(userSearchSchema, 'query'), userController.search);
router.get('/profile', userController.getProfile);
router.put('/profile', validate(updateProfileSchema), userController.updateProfile);
router.put('/password', validate(changePasswordSchema), userController.changePassword);
router.put('/ssh-defaults', validate(sshTerminalConfigSchema), userController.updateSshDefaults);
router.put('/rdp-defaults', validate(rdpSettingsSchema), userController.updateRdpDefaults);
router.post('/avatar', validate(uploadAvatarSchema), userController.uploadAvatar);
router.get('/domain-profile', userController.getDomainProfile);
router.put('/domain-profile', validate(updateDomainProfileSchema), userController.updateDomainProfile);
router.delete('/domain-profile', userController.clearDomainProfile);

// Identity verification & sensitive operations
router.post('/email-change/initiate', identityVerificationLimiter, validate(initiateEmailChangeSchema), userController.initiateEmailChange);
router.post('/email-change/confirm', validate(confirmEmailChangeSchema), userController.confirmEmailChange);
router.post('/password-change/initiate', identityVerificationLimiter, userController.initiatePasswordChange);
router.post('/identity/initiate', identityVerificationLimiter, validate(initiateIdentitySchema), userController.initiateIdentity);
router.post('/identity/confirm', validate(confirmIdentitySchema), userController.confirmIdentity);

export default router;
