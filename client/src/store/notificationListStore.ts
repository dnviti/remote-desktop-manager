import { create } from 'zustand';
import {
  NotificationEntry,
  getNotifications,
  markAsRead as apiMarkAsRead,
  markAllAsRead as apiMarkAllAsRead,
  deleteNotification as apiDeleteNotification,
} from '../api/notifications.api';

interface NotificationListState {
  notifications: NotificationEntry[];
  unreadCount: number;
  total: number;
  loading: boolean;

  fetchNotifications: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  removeNotification: (id: string) => Promise<void>;
  addNotification: (notification: NotificationEntry) => void;
  reset: () => void;
}

export const useNotificationListStore = create<NotificationListState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  total: 0,
  loading: false,

  fetchNotifications: async () => {
    set({ loading: true });
    try {
      const result = await getNotifications({ limit: 50 });
      set({
        notifications: result.data,
        total: result.total,
        unreadCount: result.unreadCount,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  markAsRead: async (id: string) => {
    await apiMarkAsRead(id);
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllAsRead: async () => {
    await apiMarkAllAsRead();
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  removeNotification: async (id: string) => {
    const notification = get().notifications.find((n) => n.id === id);
    await apiDeleteNotification(id);
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
      total: state.total - 1,
      unreadCount: notification && !notification.read
        ? Math.max(0, state.unreadCount - 1)
        : state.unreadCount,
    }));
  },

  addNotification: (notification: NotificationEntry) => {
    set((state) => ({
      notifications: [notification, ...state.notifications],
      total: state.total + 1,
      unreadCount: state.unreadCount + 1,
    }));
  },

  reset: () => set({ notifications: [], unreadCount: 0, total: 0, loading: false }),
}));
