import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config';
import { logger } from '../utils/logger';
import prisma from '../lib/prisma';
import * as sshKeyService from './sshkey.service';
import * as gatewayService from './gateway.service';
import * as auditService from './audit.service';

let rotationTask: ScheduledTask | null = null;
let ldapSyncTask: ScheduledTask | null = null;
let membershipExpiryTask: ScheduledTask | null = null;
let checkoutExpiryTask: ScheduledTask | null = null;
let passwordRotationTask: ScheduledTask | null = null;

export function startKeyRotationJob(): void {
  const cronExpr = config.keyRotationCron;

  if (!cron.validate(cronExpr)) {
    logger.error(
      `[scheduler] Invalid KEY_ROTATION_CRON expression: "${cronExpr}". ` +
        'Key rotation job will NOT run. Fix the expression and restart.',
    );
    return;
  }

  rotationTask = cron.schedule(
    cronExpr,
    () => {
      processKeyRotations().catch((err) => {
        logger.error('[scheduler] Unhandled error in processKeyRotations:', err);
      });
    },
    { timezone: 'UTC' },
  );

  logger.info(
    `[scheduler] SSH key rotation job scheduled: "${cronExpr}" (UTC). ` +
      `Advance days: ${config.keyRotationAdvanceDays}`,
  );
}

export async function processKeyRotations(): Promise<void> {
  const advanceDays = config.keyRotationAdvanceDays;
  const cutoffDate = new Date(Date.now() + advanceDays * 24 * 60 * 60 * 1000);

  logger.info(
    `[scheduler] Starting key rotation check. ` +
      `Cutoff: ${cutoffDate.toISOString()} (advance ${advanceDays}d)`,
  );

  const candidates = await prisma.sshKeyPair.findMany({
    where: {
      autoRotateEnabled: true,
      expiresAt: {
        not: null,
        lte: cutoffDate,
      },
    },
    select: {
      tenantId: true,
      tenant: { select: { name: true } },
      expiresAt: true,
    },
  });

  if (candidates.length === 0) {
    logger.info('[scheduler] No keys due for rotation.');
    return;
  }

  logger.info(`[scheduler] ${candidates.length} tenant(s) due for key rotation.`);

  for (const candidate of candidates) {
    const { tenantId } = candidate;
    const tenantName = candidate.tenant.name;

    try {
      const rotated = await sshKeyService.rotateKeyPair(tenantId, {
        updateExpiration: true,
      });

      logger.info(
        `[scheduler] Rotated key for tenant "${tenantName}" (${tenantId}). ` +
          `New fingerprint: ${rotated.fingerprint}. ` +
          `Next expiry: ${rotated.expiresAt?.toISOString() ?? 'none'}`,
      );

      let pushResults: Awaited<
        ReturnType<typeof gatewayService.pushKeyToAllManagedGateways>
      > = [];
      try {
        pushResults = await gatewayService.pushKeyToAllManagedGateways(tenantId);
      } catch (pushErr) {
        logger.warn(
          `[scheduler] Failed to push key for tenant "${tenantName}":`,
          (pushErr as Error).message,
        );
      }

      const pushOk = pushResults.filter((r) => r.ok).length;
      const pushFailed = pushResults.filter((r) => !r.ok).length;

      const ownerMembership = await prisma.tenantMember.findFirst({
        where: { tenantId, role: 'OWNER' },
        select: { userId: true },
      });
      const owner = ownerMembership ? { id: ownerMembership.userId } : null;

      if (owner) {
        auditService.log({
          userId: owner.id,
          action: 'SSH_KEY_AUTO_ROTATE',
          targetType: 'SshKeyPair',
          targetId: rotated.id,
          details: {
            fingerprint: rotated.fingerprint,
            expiresAt: rotated.expiresAt?.toISOString() ?? null,
            pushResults: { total: pushResults.length, ok: pushOk, failed: pushFailed },
          },
        });
      }

      if (pushFailed > 0) {
        logger.warn(
          `[scheduler] Key push partial failure for tenant "${tenantName}": ` +
            `${pushOk}/${pushResults.length} gateways succeeded.`,
        );
      }
    } catch (err) {
      logger.error(
        `[scheduler] Failed to rotate key for tenant "${tenantName}" (${tenantId}):`,
        (err as Error).message,
      );
    }
  }

  logger.info('[scheduler] Key rotation check complete.');
}

export function startLdapSyncJob(): void {
  if (!config.ldap.syncEnabled || !config.ldap.enabled) return;

  const cronExpr = config.ldap.syncCron;
  if (!cron.validate(cronExpr)) {
    logger.error(
      `[scheduler] Invalid LDAP_SYNC_CRON expression: "${cronExpr}". ` +
        'LDAP sync job will NOT run.',
    );
    return;
  }

  ldapSyncTask = cron.schedule(
    cronExpr,
    () => {
      import('./ldap.service').then((ldap) =>
        ldap.syncUsers().catch((err) => {
          logger.error('[scheduler] Unhandled error in LDAP syncUsers:', err);
        }),
      ).catch((err) => {
        logger.error('[scheduler] Failed to import ldap.service:', err);
      });
    },
    { timezone: 'UTC' },
  );

  logger.info(`[scheduler] LDAP sync job scheduled: "${cronExpr}" (UTC)`);
}

const CHECKOUT_EXPIRY_CRON = '*/5 * * * *'; // Every 5 minutes

export function startCheckoutExpiryJob(): void {
  checkoutExpiryTask = cron.schedule(
    CHECKOUT_EXPIRY_CRON,
    () => {
      import('./checkout.service').then((svc) =>
        svc.processExpiredCheckouts().catch((err) => {
          logger.error('[scheduler] Unhandled error in processExpiredCheckouts:', err);
        }),
      ).catch((err) => {
        logger.error('[scheduler] Failed to import checkout.service:', err);
      });
    },
    { timezone: 'UTC' },
  );

  logger.info(
    `[scheduler] Checkout expiry job scheduled: "${CHECKOUT_EXPIRY_CRON}" (UTC)`,
  );
}

const MEMBERSHIP_EXPIRY_CRON = '*/5 * * * *';

export function startMembershipExpiryJob(): void {
  membershipExpiryTask = cron.schedule(
    MEMBERSHIP_EXPIRY_CRON,
    () => {
      processExpiredMemberships().catch((err) => {
        logger.error('[scheduler] Unhandled error in processExpiredMemberships:', err);
      });
    },
    { timezone: 'UTC' },
  );

  logger.info(
    `[scheduler] Membership expiry job scheduled: "${MEMBERSHIP_EXPIRY_CRON}" (UTC)`,
  );
}

export async function processExpiredMemberships(): Promise<void> {
  const now = new Date();
  logger.info(`[scheduler] Starting membership expiry check at ${now.toISOString()}`);

  // --- Expired TenantMembers (exclude OWNER) ---
  const expiredTenantMembers = await prisma.tenantMember.findMany({
    where: {
      expiresAt: { not: null, lte: now },
      role: { not: 'OWNER' },
    },
    include: {
      user: { select: { id: true, email: true } },
      tenant: { select: { id: true, name: true } },
    },
  });

  for (const m of expiredTenantMembers) {
    try {
      await prisma.$transaction([
        // Remove from all teams in this tenant
        prisma.teamMember.deleteMany({
          where: {
            userId: m.userId,
            team: { tenantId: m.tenantId },
          },
        }),
        // Delete the tenant membership
        prisma.tenantMember.delete({
          where: { id: m.id },
        }),
        // Revoke refresh tokens to force re-auth
        prisma.refreshToken.deleteMany({
          where: { userId: m.userId },
        }),
      ]);

      auditService.log({
        userId: m.userId,
        action: 'TENANT_MEMBERSHIP_EXPIRED',
        targetType: 'TenantMember',
        targetId: m.id,
        details: {
          tenantId: m.tenantId,
          tenantName: m.tenant.name,
          email: m.user.email,
          expiresAt: m.expiresAt?.toISOString(),
        },
      });

      logger.info(
        `[scheduler] Expired tenant membership: user "${m.user.email}" from tenant "${m.tenant.name}"`,
      );
    } catch (err) {
      logger.error(
        `[scheduler] Failed to expire tenant membership ${m.id}:`,
        (err as Error).message,
      );
    }
  }

  // --- Expired TeamMembers ---
  const expiredTeamMembers = await prisma.teamMember.findMany({
    where: {
      expiresAt: { not: null, lte: now },
    },
    include: {
      user: { select: { id: true, email: true } },
      team: { select: { id: true, name: true } },
    },
  });

  for (const m of expiredTeamMembers) {
    try {
      await prisma.teamMember.delete({
        where: { id: m.id },
      });

      auditService.log({
        userId: m.userId,
        action: 'TEAM_MEMBERSHIP_EXPIRED',
        targetType: 'TeamMember',
        targetId: m.id,
        details: {
          teamId: m.teamId,
          teamName: m.team.name,
          email: m.user.email,
          expiresAt: m.expiresAt?.toISOString(),
        },
      });

      logger.info(
        `[scheduler] Expired team membership: user "${m.user.email}" from team "${m.team.name}"`,
      );
    } catch (err) {
      logger.error(
        `[scheduler] Failed to expire team membership ${m.id}:`,
        (err as Error).message,
      );
    }
  }

  const total = expiredTenantMembers.length + expiredTeamMembers.length;
  if (total > 0) {
    logger.info(`[scheduler] Membership expiry check complete. Expired: ${total}`);
  }
}

// Password rotation job: runs daily at 3 AM UTC
const PASSWORD_ROTATION_CRON = '0 3 * * *';

export function startPasswordRotationJob(): void {
  passwordRotationTask = cron.schedule(
    PASSWORD_ROTATION_CRON,
    () => {
      import('./passwordRotation.service').then((svc) =>
        svc.processScheduledRotations().catch((err) => {
          logger.error('[scheduler] Unhandled error in processScheduledRotations:', err);
        }),
      ).catch((err) => {
        logger.error('[scheduler] Failed to import passwordRotation.service:', err);
      });
    },
    { timezone: 'UTC' },
  );

  logger.info(
    `[scheduler] Password rotation job scheduled: "${PASSWORD_ROTATION_CRON}" (UTC)`,
  );
}

export function reloadKeyRotationJob(): void {
  if (rotationTask) { rotationTask.stop(); rotationTask = null; }
  startKeyRotationJob();
}

export function reloadLdapSyncJob(): void {
  if (ldapSyncTask) { ldapSyncTask.stop(); ldapSyncTask = null; }
  startLdapSyncJob();
}

export function stopAllJobs(): void {
  if (rotationTask) {
    rotationTask.stop();
    rotationTask = null;
  }
  if (ldapSyncTask) {
    ldapSyncTask.stop();
    ldapSyncTask = null;
  }
  if (membershipExpiryTask) {
    membershipExpiryTask.stop();
    membershipExpiryTask = null;
  }
  if (checkoutExpiryTask) {
    checkoutExpiryTask.stop();
    checkoutExpiryTask = null;
  }
  if (passwordRotationTask) {
    passwordRotationTask.stop();
    passwordRotationTask = null;
  }
  logger.info('[scheduler] All scheduled jobs stopped.');
}
