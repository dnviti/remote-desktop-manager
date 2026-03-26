import crypto from 'crypto';
import prisma from '../lib/prisma';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AuthPayload } from '../types';
import { verifyJwt } from '../utils/jwt';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import { parseExpiry } from '../utils/format';

const log = logger.child('auth');
import {
  generateSalt,
  generateMasterKey,
  deriveKeyFromPassword,
  encryptMasterKey,
  decryptMasterKey,
  storeVaultSession,
  storeVaultRecovery,
  lockVault,
  generateRecoveryKey,
  encryptMasterKeyWithRecovery,
} from './crypto.service';
import { verifyCode as verifyTotpCode, getDecryptedSecret } from './totp.service';
import { encrypt, getMasterKey } from './crypto.service';
import { sendVerificationEmail } from './email';
import * as auditService from './audit.service';
import { getSelfSignupEnabled } from './appConfig.service';
import { computeBindingHash } from '../utils/tokenBinding';
import { assertPasswordNotBreached } from './password.service';

const BCRYPT_ROUNDS = 12;
const RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export async function register(email: string, password: string) {
  const selfSignupEnabled = await getSelfSignupEnabled();
  if (!selfSignupEnabled) {
    throw new AppError('Registration is currently disabled. Contact your administrator.', 403);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  const needsVerification = config.emailVerifyRequired;

  if (existing) {
    // Return the same response as a successful registration to prevent email enumeration
    return {
      message: needsVerification
        ? 'Registration successful. Please check your email to verify your account.'
        : 'Registration successful. You can now log in.',
      userId: existing.id,
      emailVerifyRequired: needsVerification,
      recoveryKey: '', // Dummy key, they already have an account
    };
  }

  // Check password against known data breaches (HIBP k-Anonymity)
  await assertPasswordNotBreached(password);

  // Hash password for login
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Generate vault encryption
  const vaultSalt = generateSalt();
  const masterKey = generateMasterKey();
  const derivedKey = await deriveKeyFromPassword(password, vaultSalt);
  const encryptedVault = encryptMasterKey(masterKey, derivedKey);

  // Generate vault recovery key (shown once to user)
  const recoveryKey = generateRecoveryKey();
  const recoveryResult = await encryptMasterKeyWithRecovery(masterKey, recoveryKey);

  const emailVerifyToken = needsVerification ? crypto.randomBytes(32).toString('hex') : null;
  const emailVerifyExpiry = needsVerification ? new Date(Date.now() + EMAIL_VERIFY_TTL_MS) : null;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      vaultSalt,
      encryptedVaultKey: encryptedVault.ciphertext,
      vaultKeyIV: encryptedVault.iv,
      vaultKeyTag: encryptedVault.tag,
      encryptedVaultRecoveryKey: recoveryResult.encrypted.ciphertext,
      vaultRecoveryKeyIV: recoveryResult.encrypted.iv,
      vaultRecoveryKeyTag: recoveryResult.encrypted.tag,
      vaultRecoveryKeySalt: recoveryResult.salt,
      emailVerified: !needsVerification,
      emailVerifyToken,
      emailVerifyExpiry,
    },
    select: { id: true, email: true, createdAt: true },
  });

  // Zero out sensitive data
  masterKey.fill(0);
  derivedKey.fill(0);

  if (needsVerification && emailVerifyToken) {
    sendVerificationEmail(email, emailVerifyToken).catch((err) => {
      log.error('Failed to send verification email:', err);
    });
  }

  log.verbose(`User registered: ${user.id} (${email})`);

  return {
    message: needsVerification
      ? 'Registration successful. Please check your email to verify your account.'
      : 'Registration successful. You can now log in.',
    userId: user.id,
    emailVerifyRequired: needsVerification,
    recoveryKey,
  };
}

async function enforceConcurrentSessionLimit(
  userId: string,
  tenantId: string | undefined,
): Promise<void> {
  // Resolve effective limit: tenant > config fallback
  let maxSessions = config.maxConcurrentSessions;
  if (tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { maxConcurrentSessions: true },
    });
    if (tenant && tenant.maxConcurrentSessions !== null && tenant.maxConcurrentSessions !== undefined) {
      maxSessions = tenant.maxConcurrentSessions;
    }
  }

  if (maxSessions <= 0) return; // unlimited

  // Count distinct active token families for this user
  const activeFamilies = await prisma.refreshToken.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { tokenFamily: true, familyCreatedAt: true },
    distinct: ['tokenFamily'],
    orderBy: { familyCreatedAt: 'asc' },
  });

  if (activeFamilies.length <= maxSessions) return;

  // Evict the oldest families until we're at the limit
  const familiesToEvict = activeFamilies.slice(0, activeFamilies.length - maxSessions);
  for (const family of familiesToEvict) {
    await prisma.refreshToken.deleteMany({
      where: { tokenFamily: family.tokenFamily, userId },
    });

    auditService.log({
      userId,
      action: 'SESSION_LIMIT_EXCEEDED',
      details: {
        evictedFamily: family.tokenFamily,
        maxConcurrentSessions: maxSessions,
        reason: 'Concurrent session limit exceeded — oldest session evicted',
      },
    });
  }
}

async function getEffectiveAbsoluteTimeout(userId: string): Promise<number> {
  const membership = await prisma.tenantMember.findFirst({
    where: { userId, isActive: true },
    include: { tenant: { select: { absoluteSessionTimeoutSeconds: true } } },
  });
  return membership?.tenant.absoluteSessionTimeoutSeconds ?? config.absoluteSessionTimeoutSeconds;
}

export async function issueTokens(user: {
  id: string;
  email: string;
  username: string | null;
  avatarData: string | null;
}, tokenFamily?: string, binding?: { ip: string; userAgent: string }, mfaMethod?: import('../types').MfaMethod) {
  // Fetch all tenant memberships for the user
  const allMemberships = await prisma.tenantMember.findMany({
    where: { userId: user.id },
    include: { tenant: { select: { id: true, name: true, slug: true, jwtExpiresInSeconds: true, jwtRefreshExpiresInSeconds: true } } },
    orderBy: { joinedAt: 'asc' },
  });

  // Filter out expired memberships
  const now = new Date();
  const validMemberships = allMemberships.filter(
    (m) => !m.expiresAt || m.expiresAt > now,
  );

  // Resolve active membership, auto-activating if exactly one exists
  let activeMembership = validMemberships.find((m) => m.isActive);
  if (!activeMembership && validMemberships.length === 1) {
    await prisma.tenantMember.update({
      where: { id: validMemberships[0].id },
      data: { isActive: true },
    });
    activeMembership = { ...validMemberships[0], isActive: true };
  }

  const ipUaHash = binding && config.tokenBindingEnabled
    ? computeBindingHash(binding.ip, binding.userAgent)
    : undefined;

  const payload: AuthPayload = {
    userId: user.id,
    email: user.email,
    ...(activeMembership && { tenantId: activeMembership.tenantId }),
    ...(activeMembership && { tenantRole: activeMembership.role as AuthPayload['tenantRole'] }),
    ...(ipUaHash && { ipUaHash }),
    ...(mfaMethod && { mfaMethod }),
  };
  // Resolve effective token lifetimes (tenant override > config default)
  const activeTenantSettings = activeMembership?.tenant;
  const effectiveAccessExpiresIn = activeTenantSettings?.jwtExpiresInSeconds
    ? `${activeTenantSettings.jwtExpiresInSeconds}s`
    : (config.jwtExpiresIn as string);
  const effectiveRefreshExpiresMs = activeTenantSettings?.jwtRefreshExpiresInSeconds
    ? activeTenantSettings.jwtRefreshExpiresInSeconds * 1000
    : parseExpiry(config.jwtRefreshExpiresIn);

  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: effectiveAccessExpiresIn,
  } as jwt.SignOptions);

  const refreshTokenValue = uuidv4();
  const refreshExpiresMs = effectiveRefreshExpiresMs;
  const family = tokenFamily ?? uuidv4();

  // Preserve familyCreatedAt during token rotation (existing family)
  let familyCreatedAt: Date | undefined;
  if (tokenFamily) {
    const existing = await prisma.refreshToken.findFirst({
      where: { tokenFamily, userId: user.id },
      select: { familyCreatedAt: true },
      orderBy: { createdAt: 'desc' },
    });
    familyCreatedAt = existing?.familyCreatedAt ?? undefined;
  }

  await prisma.refreshToken.create({
    data: {
      token: refreshTokenValue,
      userId: user.id,
      tokenFamily: family,
      expiresAt: new Date(Date.now() + refreshExpiresMs),
      ...(ipUaHash && { ipUaHash }),
      ...(familyCreatedAt && { familyCreatedAt }),
    },
  });

  // Enforce concurrent session limit (evict oldest families if over limit)
  await enforceConcurrentSessionLimit(user.id, activeMembership?.tenantId);

  return {
    accessToken,
    refreshToken: refreshTokenValue,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      avatarData: user.avatarData,
      tenantId: activeMembership?.tenantId,
      tenantRole: activeMembership?.role,
    },
    tenantMemberships: validMemberships.map((m) => ({
      tenantId: m.tenant.id,
      name: m.tenant.name,
      slug: m.tenant.slug,
      role: m.role,
      isActive: m.isActive,
    })),
  };
}

export async function switchTenant(userId: string, targetTenantId: string, binding?: { ip: string; userAgent: string }) {
  // Verify the user has a membership in the target tenant
  const membership = await prisma.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId: targetTenantId, userId } },
  });
  if (!membership) {
    throw new AppError('You are not a member of this organization', 403);
  }
  if (membership.expiresAt && membership.expiresAt <= new Date()) {
    throw new AppError('Your membership in this organization has expired', 403);
  }

  // Transactionally deactivate all memberships and activate the target
  await prisma.$transaction([
    prisma.tenantMember.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    }),
    prisma.tenantMember.update({
      where: { tenantId_userId: { tenantId: targetTenantId, userId } },
      data: { isActive: true },
    }),
  ]);

  // Revoke all existing refresh tokens
  await prisma.refreshToken.deleteMany({ where: { userId } });

  // Issue fresh tokens
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, username: true, avatarData: true },
  });

  return issueTokens(user, undefined, binding);
}

async function tryLdapLogin(
  email: string,
  password: string,
  ipAddress?: string | string[],
  binding?: { ip: string; userAgent: string },
) {
  const ldapService = await import('./ldap.service');
  const ldapEntry = await ldapService.authenticateUser(email, password);
  if (!ldapEntry) return null;

  // LDAP auth succeeded — find or create user
  let user = await prisma.user.findUnique({
    where: { email: ldapEntry.email.toLowerCase() },
    select: {
      id: true, email: true, username: true, avatarData: true, enabled: true,
      vaultSalt: true, encryptedVaultKey: true, vaultKeyIV: true, vaultKeyTag: true,
      vaultSetupComplete: true,
      totpEnabled: true, smsMfaEnabled: true, webauthnEnabled: true,
      tenantMemberships: {
        where: { isActive: true },
        take: 1,
        include: { tenant: { select: { mfaRequired: true } } },
      },
    },
  });

  if (!user) {
    if (!config.ldap.autoProvision) return null;

    // Auto-provision new user from LDAP
    const newUser = await prisma.user.create({
      data: {
        email: ldapEntry.email.toLowerCase(),
        username: ldapEntry.displayName || ldapEntry.uid,
        vaultSetupComplete: false,
        emailVerified: true,
      },
      select: {
        id: true, email: true, username: true, avatarData: true, enabled: true,
        vaultSalt: true, encryptedVaultKey: true, vaultKeyIV: true, vaultKeyTag: true,
        vaultSetupComplete: true,
        totpEnabled: true, smsMfaEnabled: true, webauthnEnabled: true,
        tenantMemberships: {
          where: { isActive: true },
          take: 1,
          include: { tenant: { select: { mfaRequired: true } } },
        },
      },
    });

    // Link LDAP account
    await prisma.oAuthAccount.create({
      data: {
        userId: newUser.id,
        provider: 'LDAP',
        providerUserId: ldapEntry.providerUserId,
        providerEmail: ldapEntry.email.toLowerCase(),
        samlAttributes: {
          dn: ldapEntry.dn,
          uid: ldapEntry.uid,
          groups: ldapEntry.groups,
        },
      },
    });

    // Auto-assign to default tenant if configured
    if (config.ldap.defaultTenantId) {
      await prisma.tenantMember.create({
        data: {
          tenantId: config.ldap.defaultTenantId,
          userId: newUser.id,
          role: 'MEMBER',
        },
      }).catch(() => { /* already a member */ });
    }

    auditService.log({
      userId: newUser.id,
      action: 'LDAP_USER_CREATED',
      details: { email: ldapEntry.email, uid: ldapEntry.uid },
      ipAddress,
    });

    user = newUser;
  }

  if (!user.enabled) {
    throw new AppError('Your account has been disabled. Contact your administrator.', 403);
  }

  // Unlock vault if set up (LDAP users may or may not have vault)
  if (user.vaultSalt && user.encryptedVaultKey && user.vaultKeyIV && user.vaultKeyTag) {
    const derivedKey = await deriveKeyFromPassword(password, user.vaultSalt);
    const mk = decryptMasterKey(
      { ciphertext: user.encryptedVaultKey, iv: user.vaultKeyIV, tag: user.vaultKeyTag },
      derivedKey,
    );
    storeVaultSession(user.id, mk);
    storeVaultRecovery(user.id, mk);
    mk.fill(0);
    derivedKey.fill(0);
  }

  auditService.log({ userId: user.id, action: 'LDAP_LOGIN', ipAddress });
  log.verbose(`LDAP login successful for user ${user.id} (${email})`);

  // MFA checks
  const mfaMethods: ('totp' | 'sms' | 'webauthn')[] = [];
  if (user.totpEnabled) mfaMethods.push('totp');
  if (user.smsMfaEnabled) mfaMethods.push('sms');
  if (user.webauthnEnabled) mfaMethods.push('webauthn');

  if (mfaMethods.length > 0) {
    const tempToken = jwt.sign(
      { userId: user.id, purpose: 'mfa-verify' },
      config.jwtSecret,
      { expiresIn: '5m' } as jwt.SignOptions,
    );
    return {
      requiresMFA: true as const,
      requiresTOTP: mfaMethods.includes('totp') as true,
      methods: mfaMethods,
      tempToken,
    };
  }

  // Tenant mandatory MFA check
  const activeTenantMembership = user.tenantMemberships[0];
  if (activeTenantMembership?.tenant.mfaRequired && !user.totpEnabled && !user.smsMfaEnabled && !user.webauthnEnabled) {
    const setupToken = jwt.sign(
      { userId: user.id, purpose: 'mfa-setup' },
      config.jwtSecret,
      { expiresIn: '15m' } as jwt.SignOptions,
    );
    return { mfaSetupRequired: true as const, tempToken: setupToken };
  }

  const tokens = await issueTokens(user, undefined, binding);
  return { requiresMFA: false as const, ...tokens };
}

export async function login(email: string, password: string, ipAddress?: string | string[], binding?: { ip: string; userAgent: string }) {
  // Try LDAP first if enabled
  const ldapService = await import('./ldap.service');
  if (ldapService.isEnabled()) {
    const ldapResult = await tryLdapLogin(email, password, ipAddress, binding);
    if (ldapResult) return ldapResult;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      tenantMemberships: {
        where: { isActive: true },
        take: 1,
        include: { tenant: { select: { mfaRequired: true, accountLockoutThreshold: true, accountLockoutDurationMs: true } } },
      },
    },
  });

  if (!user) {
    auditService.log({
      action: 'LOGIN_FAILURE',
      details: { reason: 'user_not_found', email },
      ipAddress,
    });
    throw new Error('Invalid email or password');
  }

  // Resolve effective lockout settings (tenant override > config default)
  const tenantSettings = user.tenantMemberships[0]?.tenant;
  const effectiveLockoutThreshold = tenantSettings?.accountLockoutThreshold ?? config.accountLockoutThreshold;
  const effectiveLockoutDurationMs = tenantSettings?.accountLockoutDurationMs ?? config.accountLockoutDurationMs;

  // Check if account is disabled
  if (!user.enabled) {
    auditService.log({
      userId: user.id,
      action: 'LOGIN_FAILURE',
      details: { reason: 'account_disabled', email },
      ipAddress,
    });
    throw new AppError('Your account has been disabled. Contact your administrator.', 403);
  }

  // Check account lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMs = user.lockedUntil.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60_000);
    auditService.log({
      userId: user.id,
      action: 'LOGIN_FAILURE',
      details: { reason: 'account_locked', email },
      ipAddress,
    });
    throw new AppError(
      `Account is temporarily locked. Try again in ${remainingMin} minute${remainingMin === 1 ? '' : 's'}.`,
      423,
    );
  }

  // OAuth-only users cannot use password login
  if (!user.passwordHash) {
    auditService.log({
      userId: user.id,
      action: 'LOGIN_FAILURE',
      details: { reason: 'oauth_only_account', email },
      ipAddress,
    });
    throw new AppError('This account uses social login. Please sign in with your OAuth provider.', 400);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const newFailedAttempts = user.failedLoginAttempts + 1;
    const lockout =
      newFailedAttempts >= effectiveLockoutThreshold
        ? { lockedUntil: new Date(Date.now() + effectiveLockoutDurationMs), failedLoginAttempts: 0 }
        : { failedLoginAttempts: newFailedAttempts };
    await prisma.user.update({ where: { id: user.id }, data: lockout });
    auditService.log({
      userId: user.id,
      action: 'LOGIN_FAILURE',
      details: {
        reason: 'invalid_password',
        email,
        failedAttempts: newFailedAttempts,
        accountLocked: newFailedAttempts >= effectiveLockoutThreshold,
      },
      ipAddress,
    });
    throw new Error('Invalid email or password');
  }

  // Reset failed login counter on successful password check
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  if (config.emailVerifyRequired && !user.emailVerified) {
    auditService.log({
      userId: user.id,
      action: 'LOGIN_FAILURE',
      details: { reason: 'email_not_verified', email },
      ipAddress,
    });
    throw new AppError('Email not verified. Please check your inbox or resend the verification email.', 403);
  }

  // Auto-unlock vault early (before TOTP check) so it's ready
  // when the user completes the second step. If TOTP is abandoned,
  // the vault session simply expires via its TTL.
  if (user.vaultSalt && user.encryptedVaultKey && user.vaultKeyIV && user.vaultKeyTag) {
    const derivedKey = await deriveKeyFromPassword(password, user.vaultSalt);
    const masterKey = decryptMasterKey(
      {
        ciphertext: user.encryptedVaultKey,
        iv: user.vaultKeyIV,
        tag: user.vaultKeyTag,
      },
      derivedKey
    );
    storeVaultSession(user.id, masterKey);
    storeVaultRecovery(user.id, masterKey);
    masterKey.fill(0);
    derivedKey.fill(0);
  }

  // Check which MFA methods are enabled
  const mfaMethods: ('totp' | 'sms' | 'webauthn')[] = [];
  if (user.totpEnabled) mfaMethods.push('totp');
  if (user.smsMfaEnabled) mfaMethods.push('sms');
  if (user.webauthnEnabled) mfaMethods.push('webauthn');

  if (mfaMethods.length > 0) {
    const tempToken = jwt.sign(
      { userId: user.id, purpose: 'mfa-verify' },
      config.jwtSecret,
      { expiresIn: '5m' } as jwt.SignOptions
    );
    return {
      requiresMFA: true as const,
      requiresTOTP: mfaMethods.includes('totp') as true,
      methods: mfaMethods,
      tempToken,
    };
  }

  // Check tenant mandatory MFA policy
  const activeTenantMembership = user.tenantMemberships[0];
  if (activeTenantMembership?.tenant.mfaRequired && !user.totpEnabled && !user.smsMfaEnabled && !user.webauthnEnabled) {
    const setupToken = jwt.sign(
      { userId: user.id, purpose: 'mfa-setup' },
      config.jwtSecret,
      { expiresIn: '15m' } as jwt.SignOptions
    );
    return {
      mfaSetupRequired: true as const,
      tempToken: setupToken,
    };
  }

  // Normal flow: issue real tokens
  log.verbose(`Login successful for user ${user.id} (${email})`);
  const tokens = await issueTokens(user, undefined, binding);
  return { requiresMFA: false as const, ...tokens };
}

export async function verifyTotp(tempToken: string, code: string, binding?: { ip: string; userAgent: string }) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = verifyJwt<{ userId: string; purpose: string }>(tempToken);
  } catch {
    throw new Error('Invalid or expired temporary token');
  }

  if (decoded.purpose !== 'totp-verify' && decoded.purpose !== 'mfa-verify') {
    throw new Error('Invalid token purpose');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.totpEnabled) {
    throw new Error('2FA verification failed');
  }

  const secret = await getDecryptedSecret(user, user.id);
  if (!secret) {
    throw new Error('2FA verification failed');
  }

  if (!verifyTotpCode(secret, code)) {
    throw new Error('Invalid TOTP code');
  }

  // Lazy migration: encrypt plaintext TOTP secret if not yet encrypted
  if (user.totpSecret && !user.encryptedTotpSecret) {
    const masterKey = await getMasterKey(user.id);
    if (masterKey) {
      const enc = encrypt(user.totpSecret, masterKey);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          encryptedTotpSecret: enc.ciphertext,
          totpSecretIV: enc.iv,
          totpSecretTag: enc.tag,
          totpSecret: null,
        },
      });
    }
  }

  // Issue real tokens (vault was already unlocked during password step)
  return issueTokens(user, undefined, binding, 'totp');
}

export async function requestLoginSmsCode(tempToken: string) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = verifyJwt<{ userId: string; purpose: string }>(tempToken);
  } catch {
    throw new Error('Invalid or expired temporary token');
  }

  if (decoded.purpose !== 'mfa-verify') {
    throw new Error('Invalid token purpose');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { id: true, smsMfaEnabled: true, phoneNumber: true },
  });

  if (!user || !user.smsMfaEnabled || !user.phoneNumber) {
    throw new Error('SMS MFA is not available');
  }

  const { sendOtpToPhone } = await import('./smsOtp.service');
  await sendOtpToPhone(user.id, user.phoneNumber);
}

export async function requestWebAuthnOptions(tempToken: string) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = verifyJwt<{ userId: string; purpose: string }>(tempToken);
  } catch {
    throw new Error('Invalid or expired temporary token');
  }

  if (decoded.purpose !== 'mfa-verify') {
    throw new Error('Invalid token purpose');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { id: true, webauthnEnabled: true },
  });
  if (!user || !user.webauthnEnabled) {
    throw new Error('WebAuthn MFA is not available');
  }

  const { generateAuthenticationOpts } = await import('./webauthn.service');
  return generateAuthenticationOpts(user.id);
}

export async function verifyWebAuthn(tempToken: string, credential: Record<string, unknown>, binding?: { ip: string; userAgent: string }) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = verifyJwt<{ userId: string; purpose: string }>(tempToken);
  } catch {
    throw new Error('Invalid or expired temporary token');
  }

  if (decoded.purpose !== 'mfa-verify') {
    throw new Error('Invalid token purpose');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.webauthnEnabled) {
    throw new Error('WebAuthn MFA verification failed');
  }

  const { verifyAuthentication } = await import('./webauthn.service');
  // credential is AuthenticationResponseJSON from the browser — validated by simplewebauthn
  await verifyAuthentication(user.id, credential as unknown as Parameters<typeof verifyAuthentication>[1]);

  return issueTokens(user, undefined, binding, 'webauthn');
}

export async function verifySmsCode(tempToken: string, code: string, binding?: { ip: string; userAgent: string }) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = verifyJwt<{ userId: string; purpose: string }>(tempToken);
  } catch {
    throw new Error('Invalid or expired temporary token');
  }

  if (decoded.purpose !== 'mfa-verify') {
    throw new Error('Invalid token purpose');
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.smsMfaEnabled || !user.phoneNumber) {
    throw new Error('SMS MFA verification failed');
  }

  const { verifyOtp } = await import('./smsOtp.service');
  const valid = await verifyOtp(user.id, code);
  if (!valid) {
    throw new Error('Invalid or expired SMS code');
  }

  return issueTokens(user, undefined, binding, 'sms');
}

const ROTATION_GRACE_PERIOD_MS = 10_000; // 10 seconds for concurrent-tab tolerance

export async function refreshAccessToken(refreshToken: string, binding?: { ip: string; userAgent: string }) {
  const stored = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  });

  if (!stored) {
    throw new Error('Invalid or expired refresh token');
  }

  // Token binding verification: reject if IP/UA changed or binding info is missing
  if (config.tokenBindingEnabled && stored.ipUaHash) {
    if (!binding) {
      // Missing binding when token has stored hash = potential hijack
      await prisma.refreshToken.deleteMany({
        where: { tokenFamily: stored.tokenFamily },
      });
      auditService.log({
        userId: stored.userId,
        action: 'TOKEN_HIJACK_ATTEMPT',
        ipAddress: 'unknown',
        details: {
          tokenFamily: stored.tokenFamily,
          reason: 'Refresh token presented without binding info',
        },
      });
      log.warn(
        `Token binding missing for user ${stored.userId}, family ${stored.tokenFamily}. All tokens revoked.`,
      );
      throw new AppError('Token binding validation failed', 401);
    }
    const currentHash = computeBindingHash(binding.ip, binding.userAgent);
    if (currentHash !== stored.ipUaHash) {
      // Revoke entire token family — likely session hijacking
      await prisma.refreshToken.deleteMany({
        where: { tokenFamily: stored.tokenFamily },
      });
      auditService.log({
        userId: stored.userId,
        action: 'TOKEN_HIJACK_ATTEMPT',
        ipAddress: binding?.ip ?? 'unknown',
        details: {
          tokenFamily: stored.tokenFamily,
          reason: binding
            ? 'Refresh token presented from different IP/User-Agent'
            : 'Refresh token presented without binding info',
        },
      });
      log.warn(
        `Token binding mismatch for user ${stored.userId}, family ${stored.tokenFamily}. All tokens revoked.`,
      );
      throw new Error('Invalid or expired refresh token');
    }
  }

  // Absolute session timeout: check if the token family has exceeded its lifetime
  const absoluteTimeout = await getEffectiveAbsoluteTimeout(stored.userId);
  if (absoluteTimeout > 0) {
    const familyAge = Date.now() - stored.familyCreatedAt.getTime();
    if (familyAge > absoluteTimeout * 1000) {
      await prisma.refreshToken.deleteMany({
        where: { tokenFamily: stored.tokenFamily, userId: stored.userId },
      });
      auditService.log({
        userId: stored.userId,
        action: 'SESSION_ABSOLUTE_TIMEOUT',
        details: {
          tokenFamily: stored.tokenFamily,
          familyAgeSeconds: Math.round(familyAge / 1000),
          absoluteTimeoutSeconds: absoluteTimeout,
          reason: 'Absolute session timeout — re-authentication required',
        },
        ipAddress: binding?.ip,
      });
      log.info(
        `Absolute timeout for user ${stored.userId}, family ${stored.tokenFamily} ` +
        `(age: ${Math.round(familyAge / 1000)}s, limit: ${absoluteTimeout}s)`,
      );
      throw new Error('Invalid or expired refresh token');
    }
  }

  // Reuse detection: token was already rotated
  if (stored.revokedAt) {
    const timeSinceRevocation = Date.now() - stored.revokedAt.getTime();

    // Grace period for concurrent tabs using the same token
    if (timeSinceRevocation <= ROTATION_GRACE_PERIOD_MS) {
      const activeToken = await prisma.refreshToken.findFirst({
        where: {
          tokenFamily: stored.tokenFamily,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (activeToken) {
        // Rotate the successor token and issue new ones
        await prisma.refreshToken.update({
          where: { id: activeToken.id },
          data: { revokedAt: new Date() },
        });

        return issueTokens(
          {
            id: stored.user.id,
            email: stored.user.email,
            username: stored.user.username,
            avatarData: stored.user.avatarData,
          },
          stored.tokenFamily,
          binding,
        );
      }
    }

    // Outside grace period or no active successor — likely token theft
    await prisma.refreshToken.deleteMany({
      where: { tokenFamily: stored.tokenFamily },
    });

    auditService.log({
      userId: stored.userId,
      action: 'REFRESH_TOKEN_REUSE',
      details: {
        tokenFamily: stored.tokenFamily,
        reason: 'Rotated refresh token reused — all family tokens revoked',
      },
    });

    log.warn(
      `Refresh token reuse detected for user ${stored.userId}, family ${stored.tokenFamily}. All tokens revoked.`,
    );

    throw new Error('Invalid or expired refresh token');
  }

  // Token has expired
  if (stored.expiresAt < new Date()) {
    await prisma.refreshToken.delete({ where: { id: stored.id } });
    throw new Error('Invalid or expired refresh token');
  }

  // Block disabled users
  if (!stored.user.enabled) {
    await prisma.refreshToken.deleteMany({
      where: { tokenFamily: stored.tokenFamily },
    });
    throw new Error('Invalid or expired refresh token');
  }

  // Normal rotation: mark old token as revoked, issue new one in same family
  log.verbose(`Rotating refresh token for user ${stored.userId}, family ${stored.tokenFamily}`);
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(
    {
      id: stored.user.id,
      email: stored.user.email,
      username: stored.user.username,
      avatarData: stored.user.avatarData,
    },
    stored.tokenFamily,
    binding,
  );
}

export async function logout(refreshToken: string): Promise<string | null> {
  const stored = await prisma.refreshToken.findFirst({
    where: { token: refreshToken },
    select: { userId: true, tokenFamily: true },
  });

  if (stored?.tokenFamily) {
    // Delete all tokens in the family (active and revoked)
    await prisma.refreshToken.deleteMany({
      where: { tokenFamily: stored.tokenFamily },
    });
  } else {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }

  if (stored?.userId) {
    lockVault(stored.userId);
  }

  return stored?.userId ?? null;
}

export async function verifyEmail(token: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { emailVerifyToken: token },
  });

  if (!user) {
    throw new AppError('Invalid or expired verification link.', 400);
  }

  if (user.emailVerified) {
    return; // Already verified
  }

  if (!user.emailVerifyExpiry || user.emailVerifyExpiry < new Date()) {
    throw new AppError('Verification link has expired. Please request a new one.', 400);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyExpiry: null,
    },
  });
}

export async function resendVerification(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.emailVerified) {
    return; // Silently succeed to prevent user enumeration
  }

  // Rate limit: check if last token was generated less than 60s ago
  if (user.emailVerifyExpiry) {
    const tokenCreatedAt = new Date(user.emailVerifyExpiry.getTime() - EMAIL_VERIFY_TTL_MS);
    const elapsed = Date.now() - tokenCreatedAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      return; // Silently ignore rapid requests
    }
  }

  const emailVerifyToken = crypto.randomBytes(32).toString('hex');
  const emailVerifyExpiry = new Date(Date.now() + EMAIL_VERIFY_TTL_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifyToken, emailVerifyExpiry },
  });

  sendVerificationEmail(email, emailVerifyToken).catch((err) => {
    log.error('Failed to send verification email:', err);
  });
}

export async function setupMfaDuringLogin(tempToken: string) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = verifyJwt<{ userId: string; purpose: string }>(tempToken);
  } catch {
    throw new Error('Invalid or expired temporary token');
  }
  if (decoded.purpose !== 'mfa-setup') {
    throw new Error('Invalid token purpose');
  }

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { email: true, totpEnabled: true },
  });
  if (!user) throw new Error('User not found');
  if (user.totpEnabled) throw new AppError('2FA is already enabled', 400);

  const { generateSetup, storeSetupSecret } = await import('./totp.service');
  const { secret, otpauthUri } = generateSetup(user.email);
  await storeSetupSecret(decoded.userId, secret);

  return { secret, otpauthUri };
}

export async function verifyMfaSetupDuringLogin(tempToken: string, code: string, binding?: { ip: string; userAgent: string }) {
  let decoded: { userId: string; purpose: string };
  try {
    decoded = verifyJwt<{ userId: string; purpose: string }>(tempToken);
  } catch {
    throw new Error('Invalid or expired temporary token');
  }
  if (decoded.purpose !== 'mfa-setup') {
    throw new Error('Invalid token purpose');
  }

  const { verifyAndEnable } = await import('./totp.service');
  await verifyAndEnable(decoded.userId, code);

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: {
      id: true, email: true, username: true, avatarData: true,
    },
  });
  if (!user) throw new Error('User not found');

  return issueTokens(user, undefined, binding, 'totp');
}

export async function cleanupExpiredTokens() {
  const result = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  if (result.count > 0) {
    log.info(`Cleaned up ${result.count} expired refresh token(s)`);
  }
  return result.count;
}

export async function cleanupAbsolutelyTimedOutFamilies() {
  const absoluteTimeout = config.absoluteSessionTimeoutSeconds;
  if (absoluteTimeout <= 0) return 0;

  const cutoff = new Date(Date.now() - absoluteTimeout * 1000);
  const result = await prisma.refreshToken.deleteMany({
    where: { familyCreatedAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    log.info(`Cleaned up ${result.count} token(s) from absolutely timed-out families`);
  }
  return result.count;
}

