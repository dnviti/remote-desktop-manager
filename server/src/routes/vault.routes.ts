import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as vaultController from '../controllers/vault.controller';

const router = Router();

router.use(authenticate);
router.post('/unlock', vaultController.unlock);
router.post('/lock', vaultController.lock);
router.get('/status', vaultController.status);
router.post('/reveal-password', vaultController.revealPassword);

// MFA-based vault unlock
router.post('/unlock-mfa/totp', vaultController.unlockWithTotp);
router.post('/unlock-mfa/webauthn-options', vaultController.requestWebAuthnOptions);
router.post('/unlock-mfa/webauthn', vaultController.unlockWithWebAuthn);
router.post('/unlock-mfa/request-sms', vaultController.requestSmsCode);
router.post('/unlock-mfa/sms', vaultController.unlockWithSms);

// Vault auto-lock preference
router.get('/auto-lock', vaultController.getAutoLock);
router.put('/auto-lock', vaultController.setAutoLock);

export default router;
