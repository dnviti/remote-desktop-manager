import { create } from 'zustand';

interface Notification {
  message: string;
  severity: 'error' | 'warning' | 'info' | 'success';
}

interface NotificationState {
  notification: Notification | null;
  notify: (message: string, severity?: Notification['severity']) => void;
  clear: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notification: null,

  notify: (message, severity = 'error') =>
    set({ notification: { message, severity } }),

  clear: () => set({ notification: null }),
}));
