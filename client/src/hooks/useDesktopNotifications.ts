import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiPreferencesStore } from '../store/uiPreferencesStore';

type PermissionState = NotificationPermission | 'unsupported';

export function useDesktopNotifications() {
  const enabled = useUiPreferencesStore((s) => s.desktopNotificationsEnabled);
  const setPreference = useUiPreferencesStore((s) => s.set);

  const [permission, setPermission] = useState<PermissionState>(() =>
    'Notification' in window ? Notification.permission : 'unsupported',
  );

  // Keep permission state in sync (e.g. user changes it in browser settings)
  useEffect(() => {
    if (!('Notification' in window)) return;

    // permissions API provides real-time updates
    navigator.permissions?.query({ name: 'notifications' }).then((status) => {
      const sync = () => setPermission(Notification.permission);
      status.addEventListener('change', sync);
      return () => status.removeEventListener('change', sync);
    });
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!('Notification' in window)) return 'unsupported';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const onClickRef = useRef<(() => void) | null>(null);

  const sendDesktopNotification = useCallback(
    (title: string, options?: { body?: string; tag?: string }) => {
      if (!enabled || permission !== 'granted' || !('Notification' in window)) return;
      if (document.hasFocus()) return;

      const n = new Notification(title, {
        body: options?.body,
        tag: options?.tag,
        icon: '/favicon.ico',
      });

      n.onclick = () => {
        window.focus();
        onClickRef.current?.();
        n.close();
      };
    },
    [enabled, permission],
  );

  const setEnabled = useCallback(
    async (value: boolean) => {
      if (value && permission === 'default') {
        const result = await requestPermission();
        if (result !== 'granted') return;
      }
      setPreference('desktopNotificationsEnabled', value);
    },
    [permission, requestPermission, setPreference],
  );

  return {
    supported: permission !== 'unsupported',
    permission,
    enabled,
    setEnabled,
    requestPermission,
    sendDesktopNotification,
    /** Set callback invoked when user clicks a native notification */
    setOnClick: (cb: () => void) => { onClickRef.current = cb; },
  };
}
