import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { config } from '../config';
import { AuthPayload } from '../types';
import { verifyJwt } from '../utils/jwt';
import { AppError } from '../middleware/error.middleware';
import { OAuthCallbackData, getSamlMetadata } from '../config/passport';
import { Prisma } from '../lib/prisma';
import * as oauthService from '../services/oauth.service';
import * as auditService from '../services/audit.service';
import { issueTokens } from '../services/auth.service';
import { logger } from '../utils/logger';
import { setRefreshTokenCookie, setCsrfCookie } from '../utils/cookie';
import { getClientIp } from '../utils/ip';
import { getRequestBinding } from '../utils/tokenBinding';

export function initiateSaml(req: Request, res: Response, next: NextFunction) {
  if (!config.oauth.saml.enabled) {
    return next(new AppError('SAML provider not available', 400));
  }

  passport.authenticate('saml', { session: false })(req, res, next);
}

export function initiateSamlLink(req: Request, res: Response, next: NextFunction) {
  const token = req.query.token as string;
  if (!token) return next(new AppError('Missing token', 401));

  let payload: AuthPayload;
  try {
    payload = verifyJwt<AuthPayload>(token);
  } catch {
    return next(new AppError('Invalid token', 401));
  }

  if (!config.oauth.saml.enabled) {
    return next(new AppError('SAML provider not available', 400));
  }

  const relayState = Buffer.from(JSON.stringify({
    action: 'link',
    userId: payload.userId,
  })).toString('base64url');

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

      // Check for link operation via RelayState
      const relayState = req.body?.RelayState;
      if (relayState) {
        try {
          const stateData = JSON.parse(
            Buffer.from(relayState as string, 'base64url').toString(),
          );
          if (stateData.action === 'link' && stateData.userId) {
            await oauthService.linkOAuthAccount(
              stateData.userId, oauthProfile, oauthTokens, samlAttributes,
            );
            auditService.log({
              userId: stateData.userId,
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
      auditService.log({
        userId: result.user.id,
        action: 'LOGIN_OAUTH',
        details: { provider: 'saml' },
        ipAddress: getClientIp(req),
      });

      setRefreshTokenCookie(res, tokens.refreshToken);
      const csrfToken = setCsrfCookie(res);

      const params = new URLSearchParams({
        accessToken: tokens.accessToken,
        csrfToken,
        needsVaultSetup: String(!result.user.vaultSetupComplete),
        userId: result.user.id,
        email: result.user.email,
        username: result.user.username || '',
        avatarData: result.user.avatarData || '',
        tenantId: tokens.user.tenantId || '',
        tenantRole: tokens.user.tenantRole || '',
      });

      res.redirect(`${config.clientUrl}/oauth/callback?${params.toString()}`);
    } catch (error) {
      logger.error('SAML callback error:', error);
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
