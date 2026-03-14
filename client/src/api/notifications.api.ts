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
  | 'IMPOSSIBLE_TRAVEL_DETECTED';

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
