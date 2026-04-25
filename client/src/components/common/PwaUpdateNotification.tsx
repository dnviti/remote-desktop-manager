import { useCallback, useEffect, useState } from 'react';
import { RefreshCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Detects service worker updates and prompts the user to reload for the
 * latest version. Critical for a security-sensitive app to avoid running
 * stale cached code.
 *
 * Uses vite-plugin-pwa's `useRegisterSW` hook with `registerType: 'prompt'`
 * so the new service worker waits until the user explicitly accepts the update.
 */
export default function PwaUpdateNotification() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      setRegistration(registration ?? null);
    },
  });

  useEffect(() => {
    if (!registration) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void registration.update();
    }, 60 * 60 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [registration]);

  const handleUpdate = useCallback(() => {
    void updateServiceWorker(true);
  }, [updateServiceWorker]);

  const handleDismiss = useCallback(() => {
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  if (!needRefresh) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[1400] flex justify-center px-4">
      <Card className="pointer-events-auto w-full max-w-xl border-border/80 bg-popover/95 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
            <RefreshCcw className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              A new version of Arsenale is available.
            </p>
            <p className="text-xs text-muted-foreground">
              Reload to switch to the latest client bundle.
            </p>
          </div>
          <Button size="sm" onClick={handleUpdate}>
            Reload
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={handleDismiss}
            aria-label="Dismiss update notification"
            className="size-8"
          >
            <X className="size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
