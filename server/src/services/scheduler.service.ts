import cron from 'node-cron';
import { config } from '../config';
import { logger } from '../utils/logger';
import prisma from '../lib/prisma';
import * as sshKeyService from './sshkey.service';
import * as gatewayService from './gateway.service';
import * as auditService from './audit.service';

let rotationTask: cron.ScheduledTask | null = null;

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

export function stopAllJobs(): void {
  if (rotationTask) {
    rotationTask.stop();
    rotationTask = null;
    logger.info('[scheduler] All scheduled jobs stopped.');
  }
}
