import { useTabsStore } from '@/store/tabsStore';

export function closeConnectionSurface(tabId: string) {
  const store = useTabsStore.getState();
  if (store.tabs.some((tab) => tab.id === tabId)) {
    store.closeTab(tabId);
    return;
  }

  window.close();
  window.setTimeout(() => {
    if (!window.closed) {
      window.location.assign('/');
    }
  }, 100);
}
