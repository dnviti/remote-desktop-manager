import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { config } from '../config';
import { AuthPayload } from '../types';
import { verifyJwt } from '../utils/jwt';
import { AppError } from '../middleware/error.middleware';
import { OAuthCallbackData, getSamlMetadata } from '../config/passport';
import prisma, { Prisma } from '../lib/prisma';
import * as oauthService from '../services/oauth.service';
import * as auditService from '../services/audit.service';
import { issueTokens } from '../services/auth.service';
import { logger } from '../utils/logger';
import { setRefreshTokenCookie, setCsrfCookie } from '../utils/cookie';
import { getClientIp } from '../utils/ip';
import { enforceIpAllowlist } from '../utils/ipAllowlist';
import { getRequestBinding } from '../utils/tokenBinding';
import { generateAuthCode } from '../utils/authCodeStore';
import { consumeLinkCode } from '../utils/linkCodeStore';
import { signState, verifyLinkState } from '../utils/signedState';

export function initiateSaml(req: Request, res: Response, next: NextFunction) {
  if (!config.oauth.saml.enabled) {
    return next(new AppError('SAML provider not available', 400));
  }

  passport.authenticate('saml', { session: false })(req, res, next);
}

export function initiateSamlLink(req: Request, res: Response, next: NextFunction) {
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

  if (!config.oauth.saml.enabled) {
    return next(new AppError('SAML provider not available', 400));
  }

  const relayState = signState({ action: 'link', userId });

  passport.authenticate('saml', {
    session: false,
    additionalParams: { RelayState: relayState },
  } as any)(req, res, next); // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function handleSamlCallback(req: Request, res: Response, next: NextFunction) {
  if (!config.oauth.saml.enabled) {
    return res.redirect(`${config.clientUrl}/login?error=provider_unavailable`);
  }

  passport.authenticate('saml', { session: false }, async (
    err: Error | null,
    data: OAuthCallbackData | false,
  ) => {
    try {
      if (err || !data) {
        logger.error('SAML authentication failed:', err?.message || 'No data');
        return res.redirect(`${config.clientUrl}/login?error=authentication_failed`);
      }

      const { oauthProfile, oauthTokens, samlAttributes: rawSamlAttrs } = data;
      const samlAttributes = rawSamlAttrs as Prisma.InputJsonValue | undefined;

      // Check for link operation via RelayState (HMAC-signed to prevent tampering)
      const relayState = req.body?.RelayState;
      if (relayState) {
        try {
          const linkUserId = verifyLinkState(relayState as string);
          if (linkUserId) {
            // Validate userId against the database to ensure it references a real user
            const linkUser = await prisma.user.findUnique({ where: { id: linkUserId }, select: { id: true } });
            if (!linkUser) throw new AppError('User not found', 404);

            await oauthService.linkOAuthAccount(
              linkUser.id, oauthProfile, oauthTokens, samlAttributes,
            );
            auditService.log({
              userId: linkUser.id,
              action: 'OAUTH_LINK',
              details: { provider: 'saml' },
              ipAddress: getClientIp(req),
            });
            return res.redirect(`${config.clientUrl}/settings?linked=saml`);
          }
        } catch {
          // Not a link state — proceed with login flow
        }
      }

      // Login flow
      const result = await oauthService.findOrCreateOAuthUser(
        oauthProfile, oauthTokens, samlAttributes,
      );
      const tokens = await issueTokens(result.user, undefined, getRequestBinding(req));
      const ip = getClientIp(req);
      const { flagged, blocked } = await enforceIpAllowlist(tokens.user.tenantId ?? null, ip);
      if (blocked) {
        auditService.log({ userId: result.user.id, action: 'LOGIN_FAILURE', ipAddress: ip, details: { reason: 'ip_not_allowed' } });
        return res.redirect(`${config.clientUrl}/login?error=ip_not_allowed`);
      }
      auditService.log({
        userId: result.user.id,
        action: 'LOGIN_OAUTH',
        details: { provider: 'saml' },
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
      logger.error('SAML callback error:', error instanceof Error ? error.message : 'Unknown error');
      let errorCode = 'authentication_failed';
      if (error instanceof AppError && error.statusCode === 403) {
        errorCode = error.message.includes('disabled')
          ? 'account_disabled' : 'registration_disabled';
      }
      res.redirect(`${config.clientUrl}/login?error=${encodeURIComponent(errorCode)}`);
    }
  })(req, res, next);
}

export function getMetadata(_req: Request, res: Response, next: NextFunction) {
  const xml = getSamlMetadata();
  if (!xml) {
    return next(new AppError('SAML not configured', 404));
  }
  res.type('application/xml');
  res.send(xml);
}
