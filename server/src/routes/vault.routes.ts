import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { unlockSchema, codeSchema, credentialSchema, revealSchema, autoLockSchema } from '../schemas/vault.schemas';
import * as vaultController from '../controllers/vault.controller';

const router = Router();

router.use(authenticate);
router.post('/unlock', validate(unlockSchema), vaultController.unlock);
router.post('/lock', vaultController.lock);
router.get('/status', vaultController.status);
router.post('/reveal-password', validate(revealSchema), vaultController.revealPassword);

// MFA-based vault unlock
router.post('/unlock-mfa/totp', validate(codeSchema), vaultController.unlockWithTotp);
router.post('/unlock-mfa/webauthn-options', vaultController.requestWebAuthnOptions);
router.post('/unlock-mfa/webauthn', validate(credentialSchema), vaultController.unlockWithWebAuthn);
router.post('/unlock-mfa/request-sms', vaultController.requestSmsCode);
router.post('/unlock-mfa/sms', validate(codeSchema), vaultController.unlockWithSms);

// Vault auto-lock preference
router.get('/auto-lock', vaultController.getAutoLock);
router.put('/auto-lock', validate(autoLockSchema), vaultController.setAutoLock);

export default router;
