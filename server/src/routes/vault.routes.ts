import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { vaultUnlockRateLimiter, vaultMfaRateLimiter } from '../middleware/vaultRateLimit.middleware';
import { unlockSchema, codeSchema, credentialSchema, revealSchema, autoLockSchema } from '../schemas/vault.schemas';
import * as vaultController from '../controllers/vault.controller';

const router = Router();

router.use(authenticate);
router.post('/unlock', vaultUnlockRateLimiter, validate(unlockSchema), vaultController.unlock);
router.post('/lock', vaultController.lock);
router.get('/status', vaultController.status);
router.post('/reveal-password', validate(revealSchema), vaultController.revealPassword);

// MFA-based vault unlock
router.post('/unlock-mfa/totp', vaultMfaRateLimiter, validate(codeSchema), vaultController.unlockWithTotp);
router.post('/unlock-mfa/webauthn-options', vaultMfaRateLimiter, vaultController.requestWebAuthnOptions);
router.post('/unlock-mfa/webauthn', vaultMfaRateLimiter, validate(credentialSchema), vaultController.unlockWithWebAuthn);
router.post('/unlock-mfa/request-sms', vaultMfaRateLimiter, vaultController.requestSmsCode);
router.post('/unlock-mfa/sms', vaultMfaRateLimiter, validate(codeSchema), vaultController.unlockWithSms);

// Vault auto-lock preference
router.get('/auto-lock', vaultController.getAutoLock);
router.put('/auto-lock', validate(autoLockSchema), vaultController.setAutoLock);

export default router;
