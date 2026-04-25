import { useEffect, useRef } from 'react';
import { touchAuthActivityApi } from '../api/auth.api';
import { touchVaultActivityApi } from '../api/vault.api';
import { useAuthStore } from '../store/authStore';
import { useVaultStore } from '../store/vaultStore';
import { broadcastVaultWindowSync } from '../utils/vaultWindowSync';

const ACTIVITY_TOUCH_INTERVAL_MS = 60_000;
const activityEvents: Array<keyof WindowEventMap> = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
];

export function useActivityTouch() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const setVaultUnlocked = useVaultStore((state) => state.setUnlocked);
  const lastTouchAtRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    lastTouchAtRef.current = null;
    inFlightRef.current = false;

    const handleActivity = () => {
      if (!accessToken || inFlightRef.current) {
        return;
      }

      const now = Date.now();
      if (lastTouchAtRef.current !== null && now - lastTouchAtRef.current < ACTIVITY_TOUCH_INTERVAL_MS) {
        return;
      }

      lastTouchAtRef.current = now;
      inFlightRef.current = true;
      void Promise.allSettled([touchAuthActivityApi(), touchVaultActivityApi()])
        .then(([, vaultTouchResult]) => {
          if (vaultTouchResult.status === 'fulfilled' && vaultTouchResult.value.unlocked === false) {
            setVaultUnlocked(false);
            broadcastVaultWindowSync('lock');
          }
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, handleActivity);
    }

    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, handleActivity);
      }
    };
  }, [accessToken, setVaultUnlocked]);
}
