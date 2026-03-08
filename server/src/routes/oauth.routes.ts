import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as oauthController from '../controllers/oauth.controller';

const router = Router();

// Public: list available OAuth providers
router.get('/oauth/providers', oauthController.getAvailableProviders);

// Account linking initiation (uses JWT from query param, not middleware)
router.get('/oauth/link/:provider', oauthController.initiateLinkOAuth);

// Protected routes
router.get('/oauth/accounts', authenticate, oauthController.getLinkedAccounts);
router.delete('/oauth/link/:provider', authenticate, oauthController.unlinkOAuth);
router.post('/oauth/vault-setup', authenticate, oauthController.setupVault);

// OAuth initiation + callback (public) — must come after /oauth/* routes
router.get('/:provider', oauthController.initiateOAuth);
router.get('/:provider/callback', oauthController.handleCallback);

export default router;
