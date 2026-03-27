import api from './client';

export type NotificationType =
  | 'CONNECTION_SHARED'
  | 'SHARE_PERMISSION_UPDATED'
  | 'SHARE_REVOKED'
  | 'SECRET_SHARED'
  | 'SECRET_SHARE_REVOKED'
  | 'SECRET_EXPIRING'
  | 'SECRET_EXPIRED'
  | 'TENANT_INVITATION'
  | 'RECORDING_READY'
  | 'IMPOSSIBLE_TRAVEL_DETECTED'
  | 'LATERAL_MOVEMENT_ALERT';

export interface NotificationEntry {
  id: string;
  type: NotificationType;
  message: string;
  read: boolean;
  relatedId: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  data: NotificationEntry[];
  total: number;
  unreadCount: number;
}

export interface NotificationPreference {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
}

export async function getNotifications(
  params: { limit?: number; offset?: number } = {}
): Promise<NotificationsResponse> {
  const { data } = await api.get('/notifications', { params });
  return data;
}

export async function markAsRead(id: string): Promise<void> {
  await api.put(`/notifications/${id}/read`);
}

export async function markAllAsRead(): Promise<void> {
  await api.put('/notifications/read-all');
}

export async function deleteNotification(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`);
}

export async function getPreferences(): Promise<NotificationPreference[]> {
  const { data } = await api.get('/notifications/preferences');
  return data;
}

export async function updatePreference(
  type: NotificationType,
  update: { inApp?: boolean; email?: boolean }
): Promise<NotificationPreference> {
  const { data } = await api.put(`/notifications/preferences/${type}`, update);
  return data;
}

// ---------------------------------------------------------------------------
// Notification Schedule (DND / Quiet Hours)
// ---------------------------------------------------------------------------

export interface NotificationSchedule {
  dndEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
}

export async function getNotificationSchedule(): Promise<NotificationSchedule> {
  const { data } = await api.get('/user/notification-schedule');
  return data;
}

export async function updateNotificationSchedule(
  update: Partial<NotificationSchedule>
): Promise<NotificationSchedule> {
  const { data } = await api.put('/user/notification-schedule', update);
  return data;
}
