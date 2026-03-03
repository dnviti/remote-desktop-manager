import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { smsLoginRateLimiter } from '../middleware/smsRateLimit.middleware';
import { loginRateLimiter } from '../middleware/loginRateLimit.middleware';

const router = Router();

router.post('/register', authController.register);
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);
router.post('/login', loginRateLimiter, authController.login);
router.post('/verify-totp', loginRateLimiter, authController.verifyTotp);
router.post('/request-sms-code', smsLoginRateLimiter, authController.requestSmsCode);
router.post('/verify-sms', loginRateLimiter, authController.verifySms);
router.post('/mfa-setup/init', loginRateLimiter, authController.mfaSetupInit);
router.post('/mfa-setup/verify', loginRateLimiter, authController.mfaSetupVerify);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);

export default router;
