import type { NotificationEntry } from '../services/notification.service';

export function setupNotificationHandler(): void {
  // Notifications are delivered via REST polling in the migrated frontend.
}

export function emitNotification(_userId: string, _notification: NotificationEntry): void {
  // No-op: real-time Socket.IO delivery has been removed.
}

export function emitSessionTerminated(_userId: string, _sessionId: string, _reason: string): void {
  // No-op: migrated clients detect closure via broker/session heartbeats.
}
