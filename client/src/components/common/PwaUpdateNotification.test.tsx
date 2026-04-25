import { render } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PwaUpdateNotification from './PwaUpdateNotification';

type RegisterSWOptions = {
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
};

const {
  useRegisterSW,
  updateServiceWorker,
  setNeedRefresh,
  triggerRegistration,
} = vi.hoisted(() => {
  let latestOptions: RegisterSWOptions | undefined;
  const updateServiceWorker = vi.fn();
  const setNeedRefresh = vi.fn();
  return {
    useRegisterSW: vi.fn((options?: RegisterSWOptions) => {
      latestOptions = options;
      return {
        needRefresh: [false, setNeedRefresh] as const,
        updateServiceWorker,
      };
    }),
    updateServiceWorker,
    setNeedRefresh,
    triggerRegistration: (registration: ServiceWorkerRegistration | undefined) => {
      latestOptions?.onRegisteredSW?.('/sw.js', registration);
    },
  };
});

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW,
}));

describe('PwaUpdateNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cleans up the service worker update interval on unmount', () => {
    const intervalId = 1234;
    const setIntervalSpy = vi.spyOn(window, 'setInterval').mockReturnValue(intervalId);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const registration = { update: vi.fn() } as unknown as ServiceWorkerRegistration;

    const { unmount } = render(<PwaUpdateNotification />);

    act(() => {
      triggerRegistration(registration);
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
    expect(updateServiceWorker).not.toHaveBeenCalled();
    expect(setNeedRefresh).not.toHaveBeenCalled();
  });
});
