import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller';
import { smsLoginRateLimiter } from '../middleware/smsRateLimit.middleware';
import { loginRateLimiter } from '../middleware/loginRateLimit.middleware';
import { forgotPasswordLimiter, resetPasswordLimiter, resetSmsLimiter } from '../middleware/resetRateLimit.middleware';
import { validateCsrf } from '../middleware/csrf.middleware';
import { authenticate } from '../middleware/auth.middleware';

const registrationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.get('/config', authController.publicAuthConfig);
router.post('/register', registrationRateLimiter, authController.register);
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerification);
router.post('/login', loginRateLimiter, authController.login);
router.post('/verify-totp', loginRateLimiter, authController.verifyTotp);
router.post('/request-sms-code', smsLoginRateLimiter, authController.requestSmsCode);
router.post('/verify-sms', loginRateLimiter, authController.verifySms);
router.post('/request-webauthn-options', loginRateLimiter, authController.requestWebAuthnOptions);
router.post('/verify-webauthn', loginRateLimiter, authController.verifyWebAuthn);
router.post('/mfa-setup/init', loginRateLimiter, authController.mfaSetupInit);
router.post('/mfa-setup/verify', loginRateLimiter, authController.mfaSetupVerify);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password/validate', resetPasswordLimiter, authController.validateResetToken);
router.post('/reset-password/request-sms', resetSmsLimiter, authController.requestResetSmsCode);
router.post('/reset-password/complete', resetPasswordLimiter, authController.completePasswordReset);
router.post('/refresh', validateCsrf, authController.refresh);
router.post('/logout', validateCsrf, authController.logout);
router.post('/switch-tenant', authenticate, validateCsrf, authController.switchTenant);

export default router;
