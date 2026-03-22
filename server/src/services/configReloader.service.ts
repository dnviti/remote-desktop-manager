import { logger } from '../utils/logger';

type ReloadFn = () => void | Promise<void>;

const reloaders = new Map<string, ReloadFn[]>();

/**
 * Register a reload callback for a setting group.
 * When any setting in that group changes, the callback is invoked.
 */
export function registerReload(group: string, fn: ReloadFn): void {
  const fns = reloaders.get(group) || [];
  fns.push(fn);
  reloaders.set(group, fns);
}

/**
 * Called after a setting is saved to trigger live reload of affected modules.
 */
export async function onSettingChanged(group: string): Promise<void> {
  const fns = reloaders.get(group);
  if (!fns || fns.length === 0) return;

  for (const fn of fns) {
    try {
      await fn();
    } catch (err) {
      logger.error(`Config reload failed for group "${group}":`, err);
    }
  }
  logger.verbose(`Config reloaded for group "${group}" (${fns.length} handler(s))`);
}
