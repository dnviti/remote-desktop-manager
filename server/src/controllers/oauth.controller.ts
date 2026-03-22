import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { config } from '../config';
import { AuthPayload, AuthRequest, assertAuthenticated } from '../types';
import { verifyJwt } from '../utils/jwt';
import { AppError } from '../middleware/error.middleware';
import { OAuthCallbackData } from '../config/passport';
import prisma from '../lib/prisma';
import * as oauthService from '../services/oauth.service';
import * as auditService from '../services/audit.service';
import { issueTokens } from '../services/auth.service';
import { logger } from '../utils/logger';
import { setRefreshTokenCookie, setCsrfCookie } from '../utils/cookie';
import { getClientIp } from '../utils/ip';
import { enforceIpAllowlist } from '../utils/ipAllowlist';
import { getRequestBinding } from '../utils/tokenBinding';
import { generateAuthCode, consumeAuthCode } from '../utils/authCodeStore';
import { generateLinkCode, consumeLinkCode } from '../utils/linkCodeStore';
import { signState, verifyLinkState } from '../utils/signedState';
import type { VaultSetupInput } from '../schemas/oauth.schemas';

type OAuthProvider = 'google' | 'microsoft' | 'github' | 'oidc';

const VALID_PROVIDERS: OAuthProvider[] = ['google', 'microsoft', 'github', 'oidc'];

function isValidProvider(p: string): p is OAuthProvider {
  return VALID_PROVIDERS.includes(p as OAuthProvider);
}

function isProviderEnabled(provider: OAuthProvider): boolean {
  return config.oauth[provider].enabled;
}

function getScopes(provider: OAuthProvider): string[] {
  switch (provider) {
    case 'google': return ['profile', 'email'];
    case 'microsoft': return ['user.read'];
    case 'github': return ['user:email'];
    case 'oidc': return config.oauth.oidc.scopes.split(/\s+/).filter(Boolean);
  }
}

export function initiateOAuth(req: Request, res: Response, next: NextFunction) {
  const provider = req.params.provider as string;

  if (!isValidProvider(provider) || !isProviderEnabled(provider)) {
    return next(new AppError('OAuth provider not available', 400));
  }

  passport.authenticate(provider, {
    scope: getScopes(provider),
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
        return res.redirect(`${config.clientUrl}/login?error=authentication_failed`);
      }

      const { oauthProfile, oauthTokens } = data;

      // Check if this is a link operation (HMAC-signed state prevents tampering)
      if (req.query.state) {
        try {
          const linkUserId = verifyLinkState(req.query.state as string);
          if (linkUserId) {
            // Validate userId against the database to ensure it references a real user
            const linkUser = await prisma.user.findUnique({ where: { id: linkUserId }, select: { id: true } });
            if (!linkUser) throw new AppError('User not found', 404);

            await oauthService.linkOAuthAccount(linkUser.id, oauthProfile, oauthTokens);
            auditService.log({
              userId: linkUser.id, action: 'OAUTH_LINK',
              details: { provider },
              ipAddress: getClientIp(req),
            });
            return res.redirect(`${config.clientUrl}/settings?linked=${provider}`);
          }
        } catch {
          // Not a link state — proceed with login flow
        }
      }

      // Login flow
      const result = await oauthService.findOrCreateOAuthUser(oauthProfile, oauthTokens);
      const tokens = await issueTokens(result.user, undefined, getRequestBinding(req));
      const ip = getClientIp(req);
      const { flagged, blocked } = await enforceIpAllowlist(tokens.user.tenantId ?? null, ip);
      if (blocked) {
        auditService.log({ userId: result.user.id, action: 'LOGIN_FAILURE', ipAddress: ip, details: { reason: 'ip_not_allowed' } });
        return res.redirect(`${config.clientUrl}/login?error=ip_not_allowed`);
      }
      auditService.log({
        userId: result.user.id, action: 'LOGIN_OAUTH',
        details: { provider },
        ipAddress: ip,
        ...(flagged && { flags: ['UNTRUSTED_IP'] }),
      });

      setRefreshTokenCookie(res, tokens.refreshToken);
      const csrfToken = setCsrfCookie(res);

      // Use a short-lived one-time code instead of putting tokens in the URL
      const code = generateAuthCode({
        accessToken: tokens.accessToken,
        csrfToken,
        needsVaultSetup: !result.user.vaultSetupComplete,
        userId: result.user.id,
        email: result.user.email,
        username: result.user.username || '',
        avatarData: result.user.avatarData || '',
        tenantId: tokens.user.tenantId || '',
        tenantRole: tokens.user.tenantRole || '',
      });

      res.redirect(`${config.clientUrl}/oauth/callback?code=${code}`);
    } catch (error) {
      logger.error('OAuth callback error:', error instanceof Error ? error.message : 'Unknown error');
      let errorCode = 'authentication_failed';
      if (error instanceof AppError && error.statusCode === 403) {
        errorCode = error.message.includes('disabled') ? 'account_disabled' : 'registration_disabled';
      }
      res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(errorCode)}`);
    }
  })(req, res, next);
}

export function getAvailableProviders(_req: Request, res: Response) {
  const providers: Record<string, boolean> = {};
  if (config.oauth.google.enabled) providers.google = true;
  if (config.oauth.microsoft.enabled) providers.microsoft = true;
  if (config.oauth.github.enabled) providers.github = true;
  if (config.oauth.oidc.enabled) providers.oidc = true;
  if (config.oauth.saml.enabled) providers.saml = true;
  if (config.ldap.enabled && !!config.ldap.serverUrl) providers.ldap = true;
  res.json(providers);
}

export function initiateLinkOAuth(req: Request, res: Response, next: NextFunction) {
  // Accept a one-time link code (preferred) to avoid JWTs in URL params.
  // Falls back to Authorization header, then query param token for backward compat.
  let userId: string | undefined;

  const linkCode = req.query.code as string | undefined;
  if (linkCode) {
    const resolved = consumeLinkCode(linkCode);
    if (!resolved) return next(new AppError('Invalid or expired link code', 401));
    userId = resolved;
  } else {
    const authHeader = req.headers.authorization;
    const token = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined)
      || req.query.token as string;
    if (!token) return next(new AppError('Missing authentication', 401));

    try {
      const payload = verifyJwt<AuthPayload>(token);
      userId = payload.userId;
    } catch {
      return next(new AppError('Invalid token', 401));
    }
  }

  const provider = req.params.provider as string;
  if (!isValidProvider(provider) || !isProviderEnabled(provider)) {
    return next(new AppError('OAuth provider not available', 400));
  }

  const state = signState({ action: 'link', userId });

  passport.authenticate(provider, {
    scope: getScopes(provider),
    session: false,
    state,
  })(req, res, next);
}

/**
 * Generate a short-lived one-time code for account linking.
 * The client calls this via Axios (with Authorization header),
 * then redirects to the link endpoint with ?code=... instead of ?token=...
 */
export function generateLinkCodeEndpoint(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const code = generateLinkCode(req.user.userId);
  res.json({ code });
}

export function exchangeCode(req: Request, res: Response, next: NextFunction) {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== 'string') {
    return next(new AppError('Missing authorization code', 400));
  }

  const data = consumeAuthCode(code);
  if (!data) {
    return next(new AppError('Invalid or expired authorization code', 400));
  }

  res.json(data);
}

export async function unlinkOAuth(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const provider = req.params.provider as string;
  await oauthService.unlinkOAuthAccount(req.user.userId, provider.toUpperCase());
  auditService.log({
    userId: req.user.userId, action: 'OAUTH_UNLINK',
    details: { provider },
    ipAddress: getClientIp(req),
  });
  res.json({ success: true });
}

export async function getLinkedAccounts(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const accounts = await oauthService.getLinkedAccounts(req.user.userId);
  res.json(accounts);
}

export async function setupVault(req: AuthRequest, res: Response) {
  assertAuthenticated(req);
  const { vaultPassword } = req.body as VaultSetupInput;
  await oauthService.setupVaultForOAuthUser(req.user.userId, vaultPassword);
  auditService.log({ userId: req.user.userId, action: 'VAULT_SETUP', ipAddress: getClientIp(req) });
  res.json({ success: true, vaultSetupComplete: true });
}
