import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller';
import { smsLoginRateLimiter } from '../middleware/smsRateLimit.middleware';
import { loginRateLimiter } from '../middleware/loginRateLimit.middleware';
import { forgotPasswordLimiter, resetPasswordLimiter, resetSmsLimiter } from '../middleware/resetRateLimit.middleware';
import { validateCsrf } from '../middleware/csrf.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import {
  registerSchema, loginSchema, verifyTotpSchema, requestSmsSchema, verifySmsSchema,
  requestWebAuthnSchema, verifyWebAuthnSchema, resendVerificationSchema,
  mfaSetupTokenSchema, mfaSetupVerifySchema, switchTenantSchema,
  forgotPasswordSchema, resetTokenSchema, completeResetSchema,
} from '../schemas/auth.schemas';

const registrationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.get('/config', authController.publicAuthConfig);
router.post('/register', registrationRateLimiter, validate(registerSchema), authController.register);
router.get('/verify-email', authController.verifyEmail);
router.post('/resend-verification', validate(resendVerificationSchema, 'body', 'Invalid email format'), authController.resendVerification);
router.post('/login', loginRateLimiter, validate(loginSchema), authController.login);
router.post('/verify-totp', loginRateLimiter, validate(verifyTotpSchema, 'body', 'Invalid code format'), authController.verifyTotp);
router.post('/request-sms-code', smsLoginRateLimiter, validate(requestSmsSchema, 'body', 'Invalid request'), authController.requestSmsCode);
router.post('/verify-sms', loginRateLimiter, validate(verifySmsSchema, 'body', 'Invalid code format'), authController.verifySms);
router.post('/request-webauthn-options', loginRateLimiter, validate(requestWebAuthnSchema, 'body', 'Invalid request'), authController.requestWebAuthnOptions);
router.post('/verify-webauthn', loginRateLimiter, validate(verifyWebAuthnSchema, 'body', 'Invalid request'), authController.verifyWebAuthn);
router.post('/mfa-setup/init', loginRateLimiter, validate(mfaSetupTokenSchema, 'body', 'Invalid request'), authController.mfaSetupInit);
router.post('/mfa-setup/verify', loginRateLimiter, validate(mfaSetupVerifySchema, 'body', 'Invalid code format'), authController.mfaSetupVerify);
router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema, 'body', 'Invalid email format'), authController.forgotPassword);
router.post('/reset-password/validate', resetPasswordLimiter, validate(resetTokenSchema, 'body', 'Invalid token format'), authController.validateResetToken);
router.post('/reset-password/request-sms', resetSmsLimiter, validate(resetTokenSchema, 'body', 'Invalid request'), authController.requestResetSmsCode);
router.post('/reset-password/complete', resetPasswordLimiter, validate(completeResetSchema), authController.completePasswordReset);
router.post('/refresh', validateCsrf, authController.refresh);
router.post('/logout', validateCsrf, authController.logout);
router.post('/switch-tenant', authenticate, validateCsrf, validate(switchTenantSchema), authController.switchTenant);

export default router;
