import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { smsLoginRateLimiter } from '../middleware/smsRateLimit.middleware';
import { loginRateLimiter } from '../middleware/loginRateLimit.middleware';
import { forgotPasswordLimiter, resetPasswordLimiter, resetSmsLimiter } from '../middleware/resetRateLimit.middleware';
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

router.get('/config', asyncHandler(authController.publicAuthConfig));
router.post('/register', registrationRateLimiter, validate(registerSchema), asyncHandler(authController.register));
router.get('/verify-email', asyncHandler(authController.verifyEmail));
router.post('/resend-verification', validate(resendVerificationSchema, 'body', 'Invalid email format'), asyncHandler(authController.resendVerification));
router.post('/login', loginRateLimiter, validate(loginSchema), asyncHandler(authController.login));
router.post('/verify-totp', loginRateLimiter, validate(verifyTotpSchema, 'body', 'Invalid code format'), asyncHandler(authController.verifyTotp));
router.post('/request-sms-code', smsLoginRateLimiter, validate(requestSmsSchema, 'body', 'Invalid request'), asyncHandler(authController.requestSmsCode));
router.post('/verify-sms', loginRateLimiter, validate(verifySmsSchema, 'body', 'Invalid code format'), asyncHandler(authController.verifySms));
router.post('/request-webauthn-options', loginRateLimiter, validate(requestWebAuthnSchema, 'body', 'Invalid request'), asyncHandler(authController.requestWebAuthnOptions));
router.post('/verify-webauthn', loginRateLimiter, validate(verifyWebAuthnSchema, 'body', 'Invalid request'), asyncHandler(authController.verifyWebAuthn));
router.post('/mfa-setup/init', loginRateLimiter, validate(mfaSetupTokenSchema, 'body', 'Invalid request'), asyncHandler(authController.mfaSetupInit));
router.post('/mfa-setup/verify', loginRateLimiter, validate(mfaSetupVerifySchema, 'body', 'Invalid code format'), asyncHandler(authController.mfaSetupVerify));
router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema, 'body', 'Invalid email format'), asyncHandler(authController.forgotPassword));
router.post('/reset-password/validate', resetPasswordLimiter, validate(resetTokenSchema, 'body', 'Invalid token format'), asyncHandler(authController.validateResetToken));
router.post('/reset-password/request-sms', resetSmsLimiter, validate(resetTokenSchema, 'body', 'Invalid request'), asyncHandler(authController.requestResetSmsCode));
router.post('/reset-password/complete', resetPasswordLimiter, validate(completeResetSchema), asyncHandler(authController.completePasswordReset));
router.post('/refresh', asyncHandler(authController.refresh));
router.post('/logout', asyncHandler(authController.logout));
router.post('/switch-tenant', authenticate, validate(switchTenantSchema), asyncHandler(authController.switchTenant));

export default router;
