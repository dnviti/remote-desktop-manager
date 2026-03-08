import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireTenant } from '../middleware/tenant.middleware';
import { identityVerificationLimiter } from '../middleware/identityRateLimit.middleware';
import * as userController from '../controllers/user.controller';

const router = Router();

router.use(authenticate);

router.get('/search', requireTenant, userController.search);
router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.put('/password', userController.changePassword);
router.put('/ssh-defaults', userController.updateSshDefaults);
router.put('/rdp-defaults', userController.updateRdpDefaults);
router.post('/avatar', userController.uploadAvatar);
router.get('/domain-profile', userController.getDomainProfile);
router.put('/domain-profile', userController.updateDomainProfile);
router.delete('/domain-profile', userController.clearDomainProfile);

// Identity verification & sensitive operations
router.post('/email-change/initiate', identityVerificationLimiter, userController.initiateEmailChange);
router.post('/email-change/confirm', userController.confirmEmailChange);
router.post('/password-change/initiate', identityVerificationLimiter, userController.initiatePasswordChange);
router.post('/identity/initiate', identityVerificationLimiter, userController.initiateIdentity);
router.post('/identity/confirm', userController.confirmIdentity);

export default router;
