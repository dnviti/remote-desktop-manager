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

    let status: PermissionStatus | null = null;
    const sync = () => setPermission(Notification.permission);

    // permissions API provides real-time updates when available
    navigator.permissions?.query({ name: 'notifications' }).then((s) => {
      status = s;
      status.addEventListener('change', sync);
    }).catch(() => {
      // Permissions API unavailable or unsupported — fall back to Notification.permission
    });

    return () => {
      status?.removeEventListener('change', sync);
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    if (!('Notification' in window)) return 'unsupported';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const onClickRef = useRef<(() => void) | null>(null);

  // Use refs so sendDesktopNotification identity stays stable and does not
  // cause Socket.IO reconnections when preferences or permission change.
  const enabledRef = useRef(enabled);
  const permissionRef = useRef(permission);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { permissionRef.current = permission; }, [permission]);

  const sendDesktopNotification = useCallback(
    (title: string, options?: { body?: string; tag?: string }) => {
      if (!enabledRef.current || permissionRef.current !== 'granted' || !('Notification' in window)) return;
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
    [],
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

  /** Set callback invoked when user clicks a native notification */
  const setOnClick = useCallback((cb: () => void) => {
    onClickRef.current = cb;
  }, []);

  return {
    supported: permission !== 'unsupported',
    permission,
    enabled,
    setEnabled,
    requestPermission,
    sendDesktopNotification,
    setOnClick,
  };
}
