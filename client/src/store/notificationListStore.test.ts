import {
  deleteNotification as apiDeleteNotification,
  getNotifications,
  markAllAsRead as apiMarkAllAsRead,
  markAsRead as apiMarkAsRead,
  type NotificationEntry,
} from '../api/notifications.api';
import { useNotificationListStore } from './notificationListStore';

vi.mock('../api/notifications.api', () => ({
  getNotifications: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  deleteNotification: vi.fn(),
}));

function makeNotification(id: string, read = false): NotificationEntry {
  return {
    id,
    type: 'TENANT_INVITATION',
    message: `Notification ${id}`,
    read,
    relatedId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('useNotificationListStore', () => {
  beforeEach(() => {
    useNotificationListStore.setState(useNotificationListStore.getInitialState(), true);
    vi.clearAllMocks();
    vi.mocked(apiMarkAsRead).mockResolvedValue();
    vi.mocked(apiMarkAllAsRead).mockResolvedValue();
    vi.mocked(apiDeleteNotification).mockResolvedValue();
  });

  it('fetches the latest notifications snapshot', async () => {
    vi.mocked(getNotifications).mockResolvedValue({
      data: [makeNotification('n-1'), makeNotification('n-2', true)],
      total: 2,
      unreadCount: 1,
    });

    await useNotificationListStore.getState().fetchNotifications();

    expect(getNotifications).toHaveBeenCalledWith({ limit: 50 });
    expect(useNotificationListStore.getState()).toMatchObject({
      notifications: [makeNotification('n-1'), makeNotification('n-2', true)],
      total: 2,
      unreadCount: 1,
      loading: false,
    });
  });

  it('clears the loading flag when fetching fails', async () => {
    vi.mocked(getNotifications).mockRejectedValue(new Error('boom'));

    await useNotificationListStore.getState().fetchNotifications();

    expect(useNotificationListStore.getState().loading).toBe(false);
    expect(useNotificationListStore.getState().notifications).toEqual([]);
  });

  it('marks notifications as read and can mark the whole list as read', async () => {
    useNotificationListStore.setState({
      notifications: [makeNotification('n-1'), makeNotification('n-2')],
      unreadCount: 2,
      total: 2,
      loading: false,
    });

    await useNotificationListStore.getState().markAsRead('n-1');
    expect(apiMarkAsRead).toHaveBeenCalledWith('n-1');
    expect(useNotificationListStore.getState().notifications[0]?.read).toBe(true);
    expect(useNotificationListStore.getState().unreadCount).toBe(1);

    await useNotificationListStore.getState().markAllAsRead();
    expect(apiMarkAllAsRead).toHaveBeenCalled();
    expect(useNotificationListStore.getState().notifications.every((notification) => notification.read)).toBe(
      true
    );
    expect(useNotificationListStore.getState().unreadCount).toBe(0);
  });

  it('removes notifications, applies snapshots, and resets state', async () => {
    useNotificationListStore.setState({
      notifications: [makeNotification('n-1'), makeNotification('n-2', true)],
      unreadCount: 1,
      total: 2,
      loading: false,
    });

    await useNotificationListStore.getState().removeNotification('n-1');
    expect(apiDeleteNotification).toHaveBeenCalledWith('n-1');
    expect(useNotificationListStore.getState()).toMatchObject({
      notifications: [makeNotification('n-2', true)],
      total: 1,
      unreadCount: 0,
    });

    useNotificationListStore.getState().addNotification(makeNotification('n-3'));
    expect(useNotificationListStore.getState()).toMatchObject({
      total: 2,
      unreadCount: 1,
    });

    useNotificationListStore.getState().applySnapshot({
      data: [makeNotification('n-4')],
      total: 1,
      unreadCount: 1,
    });
    expect(useNotificationListStore.getState().notifications).toEqual([makeNotification('n-4')]);

    useNotificationListStore.getState().reset();
    expect(useNotificationListStore.getState()).toMatchObject({
      notifications: [],
      unreadCount: 0,
      total: 0,
      loading: false,
    });
  });
});
