import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { vaultSetupSchema } from '../schemas/oauth.schemas';
import * as oauthController from '../controllers/oauth.controller';
import { oauthFlowRateLimiter, oauthLinkRateLimiter, oauthAccountRateLimiter } from '../middleware/oauthRateLimit.middleware';

const router = Router();

// Public: list available OAuth providers
router.get('/oauth/providers', oauthFlowRateLimiter, oauthController.getAvailableProviders);

// Account linking initiation (uses JWT from query param, not middleware)
router.get('/oauth/link/:provider', oauthLinkRateLimiter, oauthController.initiateLinkOAuth);

// Protected routes
router.get('/oauth/accounts', authenticate, oauthAccountRateLimiter, asyncHandler(oauthController.getLinkedAccounts));
router.delete('/oauth/link/:provider', authenticate, oauthAccountRateLimiter, asyncHandler(oauthController.unlinkOAuth));
router.post('/oauth/vault-setup', authenticate, oauthAccountRateLimiter, validate(vaultSetupSchema), asyncHandler(oauthController.setupVault));

// OAuth initiation + callback (public) — must come after /oauth/* routes
router.get('/oauth/:provider', oauthFlowRateLimiter, oauthController.initiateOAuth);
router.get('/oauth/:provider/callback', oauthFlowRateLimiter, oauthController.handleCallback);

export default router;
