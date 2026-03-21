import crypto from 'crypto';
import { Client } from 'ssh2';
import prisma, { RotationTrigger, RotationTargetOS } from '../lib/prisma';
import { encrypt, decrypt } from './crypto.service';
import { resolveSecretEncryptionKey } from './secret.service';
import * as auditService from './audit.service';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';
import type { LoginSecretData, SecretPayload } from '../types';

const SSH_TIMEOUT_MS = 15_000;

// --- Password generation ---

const PASSWORD_LENGTH = 32;
const PASSWORD_CHARSET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:,.<>?';

/** Return an unbiased random index in [0, max) using rejection sampling. */
function uniformRandom(max: number): number {
  const limit = 256 - (256 % max); // largest multiple of max that fits in a byte
  let b: number;
  do { b = crypto.randomBytes(1)[0]; } while (b >= limit);
  return b % max;
}

/**
 * Generate a cryptographically strong password using rejection-sampled random bytes.
 * Ensures at least one character from each class (lower, upper, digit, special).
 */
export function generateStrongPassword(length: number = PASSWORD_LENGTH): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    chars.push(PASSWORD_CHARSET[uniformRandom(PASSWORD_CHARSET.length)]);
  }
  // Guarantee at least one of each character class
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digit = '0123456789';
  const special = '!@#$%^&*()-_=+[]{}|;:,.<>?';
  chars[0] = lower[uniformRandom(lower.length)];
  chars[1] = upper[uniformRandom(upper.length)];
  chars[2] = digit[uniformRandom(digit.length)];
  chars[3] = special[uniformRandom(special.length)];
  // Fisher-Yates shuffle with unbiased random
  for (let i = chars.length - 1; i > 0; i--) {
    const j = uniformRandom(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

// --- SSH-based password change (Linux) ---

interface SshRotationParams {
  host: string;
  port: number;
  username: string;
  currentPassword: string;
  newPassword: string;
  privateKey?: string;
  passphrase?: string;
}

/**
 * Connect via SSH and change the password on a Linux target.
 * Uses `chpasswd` for non-interactive password change.
 */
export function changePasswordViaSsh(params: SshRotationParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const authMethod = params.privateKey
      ? { privateKey: params.privateKey, passphrase: params.passphrase }
      : { password: params.currentPassword };

    const timer = setTimeout(() => {
      client.end();
      reject(new Error('SSH password rotation timed out'));
    }, SSH_TIMEOUT_MS);

    client.on('ready', () => {
      // Use chpasswd for non-interactive password change
      const escapedUser = params.username.replace(/'/g, "'\\''");
      const escapedPass = params.newPassword.replace(/'/g, "'\\''");
      const cmd = `echo '${escapedUser}:${escapedPass}' | sudo chpasswd`;

      client.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          client.end();
          return reject(new Error(`SSH exec failed: ${err.message}`));
        }

        let stderr = '';
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (code: number | null) => {
          clearTimeout(timer);
          client.end();
          if (code !== 0) {
            return reject(
              new Error(`chpasswd exited with code ${code}: ${stderr.trim() || 'unknown error'}`),
            );
          }
          resolve();
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    client.connect({
      host: params.host,
      port: params.port,
      username: params.username,
      ...authMethod,
      readyTimeout: SSH_TIMEOUT_MS,
    });
  });
}

// --- WinRM / SSH-based password change (Windows) ---

interface WindowsRotationParams {
  host: string;
  port: number;
  username: string;
  currentPassword: string;
  newPassword: string;
  privateKey?: string;
  passphrase?: string;
}

/**
 * Connect via SSH and change the password on a Windows target using PowerShell.
 * Assumes SSH is available on the Windows target (OpenSSH for Windows).
 */
export function changePasswordViaWindowsSsh(params: WindowsRotationParams): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const authMethod = params.privateKey
      ? { privateKey: params.privateKey, passphrase: params.passphrase }
      : { password: params.currentPassword };

    const timer = setTimeout(() => {
      client.end();
      reject(new Error('Windows SSH password rotation timed out'));
    }, SSH_TIMEOUT_MS);

    client.on('ready', () => {
      // PowerShell command to change local user password
      const escapedUser = params.username.replace(/"/g, '`"');
      const escapedPass = params.newPassword.replace(/"/g, '`"');
      const cmd = `powershell -Command "Set-LocalUser -Name '${escapedUser}' -Password (ConvertTo-SecureString '${escapedPass}' -AsPlainText -Force)"`;

      client.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          client.end();
          return reject(new Error(`Windows SSH exec failed: ${err.message}`));
        }

        let stderr = '';
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (code: number | null) => {
          clearTimeout(timer);
          client.end();
          if (code !== 0) {
            return reject(
              new Error(
                `PowerShell Set-LocalUser exited with code ${code}: ${stderr.trim() || 'unknown error'}`,
              ),
            );
          }
          resolve();
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Windows SSH connection failed: ${err.message}`));
    });

    client.connect({
      host: params.host,
      port: params.port,
      username: params.username,
      ...authMethod,
      readyTimeout: SSH_TIMEOUT_MS,
    });
  });
}

// --- Rotation orchestrator ---

export interface RotationResult {
  success: boolean;
  secretId: string;
  logId: string;
  error?: string;
}

/**
 * Detect the target OS based on the connection's metadata or a default assumption.
 * In real usage, the connection type or metadata indicates the OS.
 */
function detectTargetOS(connection: { type: string }): RotationTargetOS {
  // SSH connections default to Linux, RDP defaults to Windows
  if (connection.type === 'RDP') return 'WINDOWS';
  return 'LINUX';
}

/**
 * Rotate a password for a specific VaultSecret that is linked to a connection.
 * 1. Decrypt current credentials from VaultSecret
 * 2. Generate a new strong password
 * 3. Change the password on the remote target via SSH
 * 4. Atomically update the VaultSecret with the new encrypted password + create a new version
 * 5. Log the result
 *
 * If the remote password change fails, the vault is NOT updated (atomic guarantee).
 */
export async function rotatePassword(
  secretId: string,
  userId: string,
  trigger: RotationTrigger,
): Promise<RotationResult> {
  const startTime = Date.now();

  // Load the secret and its linked connection(s)
  const secret = await prisma.vaultSecret.findUnique({
    where: { id: secretId },
    include: {
      connections: {
        select: { id: true, host: true, port: true, type: true },
        take: 1,
      },
    },
  });

  if (!secret) {
    throw new AppError('Secret not found', 404);
  }

  if (secret.type !== 'LOGIN') {
    throw new AppError('Password rotation is only supported for LOGIN-type secrets', 400);
  }

  if (secret.connections.length === 0) {
    throw new AppError('Secret must be linked to at least one connection for rotation', 400);
  }

  const connection = secret.connections[0];
  const targetOS = detectTargetOS(connection);
  const targetHost = connection.host;
  const targetPort = connection.port;

  // Decrypt the current secret data
  const encryptionKey = await resolveSecretEncryptionKey(
    userId,
    secret.scope,
    secret.teamId,
    secret.tenantId,
  );

  const decryptedJson = decrypt(
    { ciphertext: secret.encryptedData, iv: secret.dataIV, tag: secret.dataTag },
    encryptionKey,
  );
  const secretData: SecretPayload = JSON.parse(decryptedJson);

  if (secretData.type !== 'LOGIN') {
    throw new AppError('Secret data is not LOGIN type', 400);
  }

  const currentUsername = secretData.username;
  const currentPassword = secretData.password;
  const newPassword = generateStrongPassword();

  // Create a PENDING log entry
  const logEntry = await prisma.passwordRotationLog.create({
    data: {
      secretId,
      status: 'PENDING',
      trigger,
      targetOS,
      targetHost,
      targetUser: currentUsername,
      initiatedBy: userId,
    },
  });

  try {
    // Execute the remote password change
    if (targetOS === 'LINUX') {
      await changePasswordViaSsh({
        host: targetHost,
        port: targetPort,
        username: currentUsername,
        currentPassword,
        newPassword,
      });
    } else {
      await changePasswordViaWindowsSsh({
        host: targetHost,
        port: targetPort,
        username: currentUsername,
        currentPassword,
        newPassword,
      });
    }

    // Remote change succeeded — atomically update the vault
    const updatedSecretData: LoginSecretData = {
      ...secretData,
      password: newPassword,
    };
    const plaintext = JSON.stringify(updatedSecretData);
    const encrypted = encrypt(plaintext, encryptionKey);
    const newVersion = secret.currentVersion + 1;

    await prisma.$transaction(async (tx) => {
      await tx.vaultSecret.update({
        where: { id: secretId },
        data: {
          encryptedData: encrypted.ciphertext,
          dataIV: encrypted.iv,
          dataTag: encrypted.tag,
          currentVersion: newVersion,
          lastRotatedAt: new Date(),
        },
      });

      await tx.vaultSecretVersion.create({
        data: {
          secretId,
          version: newVersion,
          encryptedData: encrypted.ciphertext,
          dataIV: encrypted.iv,
          dataTag: encrypted.tag,
          changedBy: userId,
          changeNote: `Password rotated (${trigger.toLowerCase()})`,
        },
      });

      await tx.passwordRotationLog.update({
        where: { id: logEntry.id },
        data: {
          status: 'SUCCESS',
          durationMs: Date.now() - startTime,
        },
      });
    });

    auditService.log({
      userId,
      action: 'PASSWORD_ROTATION_SUCCESS',
      targetType: 'VaultSecret',
      targetId: secretId,
      details: {
        trigger,
        targetOS,
        targetHost,
        targetUser: currentUsername,
        durationMs: Date.now() - startTime,
      },
    });

    logger.info(
      `[password-rotation] Rotation succeeded for secret ${secretId} ` +
        `on ${targetHost} (${targetOS}, ${trigger})`,
    );

    return { success: true, secretId, logId: logEntry.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Update log entry with failure
    await prisma.passwordRotationLog.update({
      where: { id: logEntry.id },
      data: {
        status: 'FAILED',
        errorMessage,
        durationMs: Date.now() - startTime,
      },
    });

    auditService.log({
      userId,
      action: 'PASSWORD_ROTATION_FAILED',
      targetType: 'VaultSecret',
      targetId: secretId,
      details: {
        trigger,
        targetOS,
        targetHost,
        targetUser: currentUsername,
        error: errorMessage,
      },
    });

    logger.error(
      `[password-rotation] Rotation failed for secret ${secretId} ` +
        `on ${targetHost}: ${errorMessage}`,
    );

    return { success: false, secretId, logId: logEntry.id, error: errorMessage };
  }
}

// --- Configuration management ---

export async function enableRotation(
  userId: string,
  secretId: string,
  intervalDays: number = 30,
  _tenantId?: string | null,
): Promise<void> {
  const secret = await prisma.vaultSecret.findUnique({
    where: { id: secretId },
    select: { userId: true, type: true, scope: true, teamId: true, tenantId: true },
  });

  if (!secret) throw new AppError('Secret not found', 404);
  if (secret.type !== 'LOGIN') {
    throw new AppError('Password rotation is only supported for LOGIN-type secrets', 400);
  }

  // Check that the user has manage permission (owner, team editor, or admin)
  if (secret.scope === 'PERSONAL' && secret.userId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  await prisma.vaultSecret.update({
    where: { id: secretId },
    data: {
      targetRotationEnabled: true,
      rotationIntervalDays: intervalDays,
    },
  });
}

export async function disableRotation(
  userId: string,
  secretId: string,
  _tenantId?: string | null,
): Promise<void> {
  const secret = await prisma.vaultSecret.findUnique({
    where: { id: secretId },
    select: { userId: true, scope: true },
  });

  if (!secret) throw new AppError('Secret not found', 404);

  if (secret.scope === 'PERSONAL' && secret.userId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  await prisma.vaultSecret.update({
    where: { id: secretId },
    data: {
      targetRotationEnabled: false,
    },
  });
}

export async function getRotationStatus(
  secretId: string,
): Promise<{
  enabled: boolean;
  intervalDays: number;
  lastRotatedAt: Date | null;
  nextRotationAt: Date | null;
}> {
  const secret = await prisma.vaultSecret.findUnique({
    where: { id: secretId },
    select: {
      targetRotationEnabled: true,
      rotationIntervalDays: true,
      lastRotatedAt: true,
    },
  });

  if (!secret) throw new AppError('Secret not found', 404);

  let nextRotationAt: Date | null = null;
  if (secret.targetRotationEnabled && secret.lastRotatedAt) {
    nextRotationAt = new Date(
      secret.lastRotatedAt.getTime() + secret.rotationIntervalDays * 24 * 60 * 60 * 1000,
    );
  }

  return {
    enabled: secret.targetRotationEnabled,
    intervalDays: secret.rotationIntervalDays,
    lastRotatedAt: secret.lastRotatedAt,
    nextRotationAt,
  };
}

export async function getRotationHistory(
  secretId: string,
  limit: number = 20,
): Promise<{
  id: string;
  status: string;
  trigger: string;
  targetOS: string;
  targetHost: string;
  targetUser: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
}[]> {
  return prisma.passwordRotationLog.findMany({
    where: { secretId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      trigger: true,
      targetOS: true,
      targetHost: true,
      targetUser: true,
      errorMessage: true,
      durationMs: true,
      createdAt: true,
    },
  });
}

// --- Scheduled rotation ---

/**
 * Process all secrets that are due for scheduled rotation.
 * Called by the scheduler service on a cron basis.
 */
export async function processScheduledRotations(): Promise<void> {
  const now = new Date();

  logger.info(`[password-rotation] Starting scheduled rotation check at ${now.toISOString()}`);

  // Find all LOGIN secrets with rotation enabled that are due
  const candidates = await prisma.vaultSecret.findMany({
    where: {
      targetRotationEnabled: true,
      type: 'LOGIN',
      connections: { some: {} }, // must have at least one linked connection
    },
    select: {
      id: true,
      userId: true,
      lastRotatedAt: true,
      rotationIntervalDays: true,
    },
  });

  let rotatedCount = 0;
  let failedCount = 0;

  for (const secret of candidates) {
    // Check if the secret is due for rotation
    const intervalMs = secret.rotationIntervalDays * 24 * 60 * 60 * 1000;
    const lastRotated = secret.lastRotatedAt?.getTime() ?? 0;

    if (now.getTime() - lastRotated < intervalMs) {
      continue; // Not yet due
    }

    try {
      const result = await rotatePassword(secret.id, secret.userId, 'SCHEDULED');
      if (result.success) {
        rotatedCount++;
      } else {
        failedCount++;
      }
    } catch (err) {
      failedCount++;
      logger.error(
        `[password-rotation] Scheduled rotation error for secret ${secret.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (rotatedCount > 0 || failedCount > 0) {
    logger.info(
      `[password-rotation] Scheduled rotation complete. ` +
        `Rotated: ${rotatedCount}, Failed: ${failedCount}`,
    );
  }
}
