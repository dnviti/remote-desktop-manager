import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { AuthPayload, AuthRequest } from '../types';
import { AppError } from '../middleware/error.middleware';
import { OAuthCallbackData } from '../config/passport';
import * as oauthService from '../services/oauth.service';
import * as auditService from '../services/audit.service';
import { issueTokens } from '../services/auth.service';
import { logger } from '../utils/logger';

type OAuthProvider = 'google' | 'microsoft' | 'github';

const VALID_PROVIDERS: OAuthProvider[] = ['google', 'microsoft', 'github'];

function isValidProvider(p: string): p is OAuthProvider {
  return VALID_PROVIDERS.includes(p as OAuthProvider);
}

function isProviderEnabled(provider: OAuthProvider): boolean {
  return config.oauth[provider].enabled;
}

const SCOPE_MAP: Record<OAuthProvider, string[]> = {
  google: ['profile', 'email'],
  microsoft: ['user.read'],
  github: ['user:email'],
};

export function initiateOAuth(req: Request, res: Response, next: NextFunction) {
  const provider = req.params.provider as string;

  if (!isValidProvider(provider) || !isProviderEnabled(provider)) {
    return next(new AppError('OAuth provider not available', 400));
  }

  passport.authenticate(provider, {
    scope: SCOPE_MAP[provider],
    session: false,
  })(req, res, next);
}

export function handleCallback(req: Request, res: Response, next: NextFunction) {
  const provider = req.params.provider as string;

  if (!isValidProvider(provider) || !isProviderEnabled(provider)) {
    return res.redirect(`${config.clientUrl}/login?error=provider_unavailable`);
  }

  passport.authenticate(provider, { session: false }, async (
    err: Error | null,
    data: OAuthCallbackData | false
  ) => {
    try {
      if (err || !data) {
        logger.error('OAuth authentication failed:', err?.message || 'No data');
        return res.redirect(
          `${config.clientUrl}/login?error=${encodeURIComponent(err?.message || 'Authentication failed')}`
        );
      }

      const { oauthProfile, oauthTokens } = data;

      // Check if this is a link operation (state contains action: 'link')
      if (req.query.state) {
        try {
          const stateData = JSON.parse(
            Buffer.from(req.query.state as string, 'base64url').toString()
          );
          if (stateData.action === 'link' && stateData.userId) {
            await oauthService.linkOAuthAccount(stateData.userId, oauthProfile, oauthTokens);
            auditService.log({
              userId: stateData.userId, action: 'OAUTH_LINK',
              details: { provider },
              ipAddress: req.ip,
            });
            return res.redirect(`${config.clientUrl}/settings?linked=${provider}`);
          }
        } catch {
          // Not a link state — proceed with login flow
        }
      }

      // Login flow
      const result = await oauthService.findOrCreateOAuthUser(oauthProfile, oauthTokens);
      const tokens = await issueTokens(result.user);
      auditService.log({
        userId: result.user.id, action: 'LOGIN_OAUTH',
        details: { provider },
        ipAddress: req.ip,
      });

      const params = new URLSearchParams({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        needsVaultSetup: String(!result.user.vaultSetupComplete),
        userId: result.user.id,
        email: result.user.email,
        username: result.user.username || '',
        avatarData: result.user.avatarData || '',
        tenantId: result.user.tenantId || '',
        tenantRole: result.user.tenantRole || '',
      });

      res.redirect(`${config.clientUrl}/oauth/callback?${params.toString()}`);
    } catch (error) {
      logger.error('OAuth callback error:', error);
      const message = error instanceof Error ? error.message : 'OAuth login failed';
      res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(message)}`);
    }
  })(req, res, next);
}

export function getAvailableProviders(_req: Request, res: Response) {
  res.json({
    google: config.oauth.google.enabled,
    microsoft: config.oauth.microsoft.enabled,
    github: config.oauth.github.enabled,
  });
}

export function initiateLinkOAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.query.token as string;
  if (!token) return next(new AppError('Missing token', 401));

  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
  } catch {
    return next(new AppError('Invalid token', 401));
  }

  const provider = req.params.provider as string;
  if (!isValidProvider(provider) || !isProviderEnabled(provider)) {
    return next(new AppError('OAuth provider not available', 400));
  }

  const state = Buffer.from(JSON.stringify({
    action: 'link',
    userId: payload.userId,
  })).toString('base64url');

  passport.authenticate(provider, {
    scope: SCOPE_MAP[provider],
    session: false,
    state,
  })(req, res, next);
}

export async function unlinkOAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const provider = req.params.provider as string;
    await oauthService.unlinkOAuthAccount(req.user!.userId, provider.toUpperCase());
    auditService.log({
      userId: req.user!.userId, action: 'OAUTH_UNLINK',
      details: { provider },
      ipAddress: req.ip,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function getLinkedAccounts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const accounts = await oauthService.getLinkedAccounts(req.user!.userId);
    res.json(accounts);
  } catch (err) {
    next(err);
  }
}

const vaultSetupSchema = z.object({
  vaultPassword: z.string().min(8),
});

export async function setupVault(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vaultPassword } = vaultSetupSchema.parse(req.body);
    await oauthService.setupVaultForOAuthUser(req.user!.userId, vaultPassword);
    auditService.log({ userId: req.user!.userId, action: 'VAULT_SETUP', ipAddress: req.ip });
    res.json({ success: true, vaultSetupComplete: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(new AppError(err.issues[0].message, 400));
    }
    next(err);
  }
}
