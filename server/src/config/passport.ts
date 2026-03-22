import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { Strategy as SamlStrategy, type Profile as SamlProfile } from '@node-saml/passport-saml';
import * as crypto from 'crypto';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface OAuthProfile {
  provider: 'GOOGLE' | 'MICROSOFT' | 'GITHUB' | 'OIDC' | 'SAML';
  providerUserId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface OAuthCallbackData {
  oauthProfile: OAuthProfile;
  oauthTokens: { accessToken: string; refreshToken?: string };
  samlAttributes?: Record<string, unknown>;
}

function makeVerifyCallback(provider: OAuthProfile['provider']) {
  return (
    accessToken: string,
    refreshToken: string,
    profile: { id: string; displayName?: string; emails?: Array<{ value: string }>; photos?: Array<{ value: string }>; _json?: Record<string, unknown> },
    done: (err: Error | null, data?: OAuthCallbackData) => void
  ) => {
    try {
      const email =
        profile.emails?.[0]?.value ||
        (profile._json?.email as string | undefined) ||
        null;

      if (!email) {
        return done(new Error(`No email returned from ${provider}. Ensure the correct scopes are requested.`));
      }

      const oauthProfile: OAuthProfile = {
        provider,
        providerUserId: profile.id,
        email,
        displayName: profile.displayName || null,
        avatarUrl: profile.photos?.[0]?.value || null,
      };

      done(null, {
        oauthProfile,
        oauthTokens: { accessToken, refreshToken },
      });
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
    }
  };
}

// --- OIDC Discovery + Custom Passport Strategy ---

interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri?: string;
}

type VerifyCallback = (
  accessToken: string,
  refreshToken: string,
  profile: { id: string; displayName?: string; emails?: Array<{ value: string }>; photos?: Array<{ value: string }>; _json?: Record<string, unknown> },
  done: (err: Error | null, data?: OAuthCallbackData) => void,
) => void;

// Temporary in-memory store for PKCE code verifiers, keyed by state
const oidcPkceStore = new Map<string, { codeVerifier: string; createdAt: number }>();

/**
 * Minimal Passport strategy for generic OIDC providers.
 * Uses OIDC Discovery and standard OAuth2 Authorization Code flow with PKCE.
 * No external dependencies beyond Node.js built-in fetch().
 */
class OidcStrategy extends passport.Strategy {
  name = 'oidc';

  private clientId: string;
  private clientSecret: string;
  private callbackUrl: string;
  private scopes: string;
  private disc: OidcDiscoveryDocument;
  private _verify: VerifyCallback;

  constructor(
    options: {
      clientId: string;
      clientSecret: string;
      callbackUrl: string;
      scopes: string;
      discovery: OidcDiscoveryDocument;
    },
    verify: VerifyCallback,
  ) {
    super();
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.callbackUrl = options.callbackUrl;
    this.scopes = options.scopes;
    this.disc = options.discovery;
    this._verify = verify;
  }

   
  authenticate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req: any,
    options?: { state?: string; scope?: string[] },
  ): void {
    // If the request has a 'code' query param, this is a callback
    if (req.query?.code || req.query?.error) {
      this._handleCallback(req)
        .catch((err) => (this as any).error(err)); // eslint-disable-line @typescript-eslint/no-explicit-any
      return;
    }

    // Build authorization redirect URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      scope: options?.scope?.join(' ') || this.scopes,
    });

    // Generate PKCE challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');

    // Determine state (may be provided for account linking)
    const state = options?.state || crypto.randomBytes(16).toString('hex');
    params.set('state', state);

    // Store PKCE verifier keyed by state
    oidcPkceStore.set(state, { codeVerifier, createdAt: Date.now() });

    // Cleanup old PKCE entries (older than 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, val] of oidcPkceStore.entries()) {
      if (val.createdAt < tenMinutesAgo) oidcPkceStore.delete(key);
    }

    const authUrl = `${this.disc.authorization_endpoint}?${params.toString()}`;
    (this as any).redirect(authUrl); // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  private async _handleCallback(req: { query?: Record<string, string | string[] | undefined> }) {
    const code = typeof req.query?.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query?.state === 'string' ? req.query.state : undefined;
    const error = typeof req.query?.error === 'string' ? req.query.error : undefined;

    if (error) {
      const errorDesc = req.query?.error_description || error;
      (this as any).fail({ message: errorDesc }, 401); // eslint-disable-line @typescript-eslint/no-explicit-any
      return;
    }

    if (!code) {
      (this as any).fail({ message: 'Missing authorization code' }, 400); // eslint-disable-line @typescript-eslint/no-explicit-any
      return;
    }

    // Retrieve and remove PKCE code_verifier
    const pkceEntry = state ? oidcPkceStore.get(state) : undefined;
    if (state) oidcPkceStore.delete(state);

    // Exchange authorization code for tokens
    const tokenParams: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.callbackUrl,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };
    if (pkceEntry?.codeVerifier) {
      tokenParams.code_verifier = pkceEntry.codeVerifier;
    }

    const tokenResponse = await fetch(this.disc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams).toString(),
    });

    if (!tokenResponse.ok) {
      logger.error('OIDC token exchange failed:', tokenResponse.status, tokenResponse.statusText);
      (this as any).fail({ message: 'Token exchange failed' }, 401); // eslint-disable-line @typescript-eslint/no-explicit-any
      return;
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
    };

    // Fetch userinfo from the IdP
    const userinfoResponse = await fetch(this.disc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userinfoResponse.ok) {
      logger.error('OIDC userinfo fetch failed:', userinfoResponse.status, userinfoResponse.statusText);
      (this as any).fail({ message: 'Failed to fetch user info' }, 401); // eslint-disable-line @typescript-eslint/no-explicit-any
      return;
    }

    const userinfo = await userinfoResponse.json() as Record<string, unknown>;

    // Map OIDC standard claims to Passport profile shape
    const profile = {
      id: String(userinfo.sub),
      displayName: (userinfo.name as string) || (userinfo.preferred_username as string) || undefined,
      emails: userinfo.email ? [{ value: userinfo.email as string }] : undefined,
      photos: userinfo.picture ? [{ value: userinfo.picture as string }] : undefined,
      _json: userinfo,
    };

    // Call the verify callback (same shape as other providers)
    this._verify(
      tokens.access_token,
      tokens.refresh_token || '',
      profile,
      (err, data) => {
        if (err) return (this as any).error(err); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!data) return (this as any).fail({ message: 'Authentication failed' }, 401); // eslint-disable-line @typescript-eslint/no-explicit-any
        (this as any).success(data); // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    );
  }
}

async function discoverOidcEndpoints(issuerUrl: string): Promise<OidcDiscoveryDocument> {
  const wellKnownUrl = issuerUrl.replace(/\/+$/, '') + '/.well-known/openid-configuration';
  const response = await fetch(wellKnownUrl);
  if (!response.ok) {
    throw new Error(`OIDC Discovery failed: ${response.status} ${response.statusText}`);
  }
  const doc = await response.json() as OidcDiscoveryDocument;

  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.userinfo_endpoint) {
    throw new Error('OIDC Discovery document missing required endpoints');
  }

  return doc;
}

export async function initializePassport(): Promise<void> {
  if (config.oauth.google.enabled) {
    const googleOptions: Record<string, unknown> = {
      clientID: config.oauth.google.clientId,
      clientSecret: config.oauth.google.clientSecret,
      callbackURL: config.oauth.google.callbackUrl,
      scope: ['profile', 'email'],
    };
    if (config.oauth.google.hd) {
      googleOptions.hd = config.oauth.google.hd;
    }
    passport.use(
      new GoogleStrategy(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        googleOptions as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeVerifyCallback('GOOGLE') as any
      )
    );
    logger.info('OAuth: Google strategy registered');
  }

  if (config.oauth.microsoft.enabled) {
    passport.use(
      new MicrosoftStrategy(
        {
          clientID: config.oauth.microsoft.clientId,
          clientSecret: config.oauth.microsoft.clientSecret,
          callbackURL: config.oauth.microsoft.callbackUrl,
          scope: ['user.read'],
          tenant: config.oauth.microsoft.tenantId,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeVerifyCallback('MICROSOFT') as any
      )
    );
    logger.info('OAuth: Microsoft strategy registered');
  }

  if (config.oauth.github.enabled) {
    passport.use(
      new GitHubStrategy(
        {
          clientID: config.oauth.github.clientId,
          clientSecret: config.oauth.github.clientSecret,
          callbackURL: config.oauth.github.callbackUrl,
          scope: ['user:email'],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        makeVerifyCallback('GITHUB') as any
      )
    );
    logger.info('OAuth: GitHub strategy registered');
  }

  if (config.oauth.oidc.enabled) {
    try {
      const discovery = await discoverOidcEndpoints(config.oauth.oidc.issuerUrl);
      passport.use(
        new OidcStrategy(
          {
            clientId: config.oauth.oidc.clientId,
            clientSecret: config.oauth.oidc.clientSecret,
            callbackUrl: config.oauth.oidc.callbackUrl,
            scopes: config.oauth.oidc.scopes,
            discovery,
          },
          makeVerifyCallback('OIDC') as VerifyCallback,
        )
      );
      logger.info(`OAuth: OIDC strategy registered (${config.oauth.oidc.providerName}, issuer: ${discovery.issuer})`);
    } catch (err) {
      logger.warn('OIDC Discovery failed — OIDC provider will be unavailable:', err instanceof Error ? err.message : err);
    }
  }

  if (config.oauth.saml.enabled) {
    const samlVerify = makeSamlVerifyCallback();
    const samlStrategy = new SamlStrategy(
      {
        entryPoint: config.oauth.saml.entryPoint,
        issuer: config.oauth.saml.issuer,
        callbackUrl: config.oauth.saml.callbackUrl,
        idpCert: config.oauth.saml.cert,
        wantAuthnResponseSigned: config.oauth.saml.wantAuthnResponseSigned,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      samlVerify as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      samlVerify as any, // logout verify callback
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    passport.use(samlStrategy as any);
    logger.info(`SAML: Strategy registered (${config.oauth.saml.providerName})`);
  }
}

/**
 * Unregister all OAuth/SSO strategies and re-register with current config values.
 * Called by configReloader when any OAuth/SAML/LDAP setting changes.
 */
export async function reloadPassportStrategies(): Promise<void> {
  for (const name of ['google', 'microsoft', 'github', 'oidc', 'saml']) {
    try { passport.unuse(name); } catch { /* strategy wasn't registered */ }
  }
  await initializePassport();
}

// --- SAML verify callback ---

function makeSamlVerifyCallback() {
  return (
    profile: SamlProfile,
    done: (err: Error | null, data?: OAuthCallbackData) => void,
  ) => {
    try {
      const email =
        (profile.nameID && profile.nameIDFormat?.includes('emailAddress') ? profile.nameID : null) ||
        (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] as string | undefined) ||
        (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'] as string | undefined) ||
        profile.nameID ||
        null;

      if (!email) {
        return done(new Error('No email returned from SAML IdP. Check NameID or attribute mapping.'));
      }

      const displayName =
        (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] as string | undefined) ||
        (profile.displayName as string | undefined) ||
        null;

      const oauthProfile: OAuthProfile = {
        provider: 'SAML',
        providerUserId: profile.nameID || email,
        email,
        displayName: displayName || null,
        avatarUrl: null,
      };

      // Build SAML-specific attributes for storage
      const samlAttributes: Record<string, unknown> = {};
      const upn = profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'] as string | undefined;
      if (upn) samlAttributes.upn = upn;
      const domain =
        (profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/windowsdomainname'] as string | undefined) ||
        (profile['http://schemas.microsoft.com/identity/claims/tenantid'] as string | undefined);
      if (domain) samlAttributes.domain = domain;
      const groups =
        profile['http://schemas.xmlsoap.org/claims/Group'] ||
        profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'];
      if (groups) samlAttributes.groups = Array.isArray(groups) ? groups : [groups];
      if (profile.nameID) samlAttributes.nameID = profile.nameID;
      if (profile.nameIDFormat) samlAttributes.nameIDFormat = profile.nameIDFormat;
      if (profile.sessionIndex) samlAttributes.sessionIndex = profile.sessionIndex;

      done(null, {
        oauthProfile,
        oauthTokens: { accessToken: '' },
        samlAttributes: Object.keys(samlAttributes).length > 0 ? samlAttributes : undefined,
      });
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
    }
  };
}

export function getSamlMetadata(): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strategy = (passport as any)._strategy('saml') as SamlStrategy | undefined;
  if (!strategy) return null;
  return strategy.generateServiceProviderMetadata(null, null);
}
