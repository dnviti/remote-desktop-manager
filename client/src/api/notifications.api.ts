import api from './client';

export type NotificationType =
  | 'CONNECTION_SHARED'
  | 'SHARE_PERMISSION_UPDATED'
  | 'SHARE_REVOKED';

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
  const res = await api.get('/notifications', { params });
  return res.data;
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
