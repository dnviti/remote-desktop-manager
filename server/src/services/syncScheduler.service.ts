import cron, { type ScheduledTask } from 'node-cron';
import { logger } from '../utils/logger';
import prisma from '../lib/prisma';

const log = logger.child('sync:scheduler');

const scheduledJobs = new Map<string, ScheduledTask>();

export function registerSyncJob(profileId: string, cronExpression: string): void {
  if (!cron.validate(cronExpression)) {
    log.error(`Invalid cron expression "${cronExpression}" for profile ${profileId}`);
    return;
  }

  // Unregister existing job if any
  unregisterSyncJob(profileId);

  const task = cron.schedule(
    cronExpression,
    () => {
      runScheduledSync(profileId).catch((err) => {
        log.error(`Scheduled sync failed for profile ${profileId}:`, err instanceof Error ? err.message : 'Unknown error');
      });
    },
    { timezone: 'UTC' },
  );

  scheduledJobs.set(profileId, task);
  log.info(`Registered sync job for profile ${profileId}: "${cronExpression}" (UTC)`);
}

export function unregisterSyncJob(profileId: string): void {
  const existing = scheduledJobs.get(profileId);
  if (existing) {
    existing.stop();
    scheduledJobs.delete(profileId);
    log.info(`Unregistered sync job for profile ${profileId}`);
  }
}

export async function startAllSyncJobs(): Promise<void> {
  const profiles = await prisma.syncProfile.findMany({
    where: {
      enabled: true,
      cronExpression: { not: null },
    },
    select: {
      id: true,
      name: true,
      cronExpression: true,
    },
  });

  for (const profile of profiles) {
    if (profile.cronExpression) {
      registerSyncJob(profile.id, profile.cronExpression);
    }
  }

  if (profiles.length > 0) {
    log.info(`Started ${profiles.length} sync job(s)`);
  }
}

export function stopAllSyncJobs(): void {
  for (const [profileId, task] of scheduledJobs.entries()) {
    task.stop();
    log.info(`Stopped sync job for profile ${profileId}`);
  }
  scheduledJobs.clear();
}

async function runScheduledSync(profileId: string): Promise<void> {
  // Lazy import to avoid circular dependency
  const syncService = await import('./sync.service');

  const profile = await prisma.syncProfile.findUnique({
    where: { id: profileId },
    select: { id: true, tenantId: true, createdById: true, enabled: true, name: true },
  });

  if (!profile || !profile.enabled) {
    log.info(`Skipping scheduled sync for profile ${profileId}: profile disabled or not found`);
    unregisterSyncJob(profileId);
    return;
  }

  log.info(`Running scheduled sync for profile "${profile.name}" (${profileId})`);

  await syncService.triggerSync(
    profile.createdById,
    profileId,
    profile.tenantId,
    false,
  );
}
