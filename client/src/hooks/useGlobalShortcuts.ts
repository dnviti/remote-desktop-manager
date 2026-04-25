import { useEffect } from 'react';
import { lockVault } from '@/api/vault.api';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useUiPreferencesStore } from '@/store/uiPreferencesStore';
import { useTabsStore } from '@/store/tabsStore';
import { useVaultStore } from '@/store/vaultStore';
import { broadcastVaultWindowSync } from '@/utils/vaultWindowSync';
import type { ConnectionFilter } from '@/components/Workspace/AppSidebar';

function isRemoteViewerFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return Boolean(
    el.closest('[data-viewer-type="rdp"]') ||
    el.closest('[data-viewer-type="vnc"]'),
  );
}

function isMonacoEditorFocused(): boolean {
  return Boolean(document.activeElement?.closest('.monaco-editor'));
}

/**
 * Global keyboard shortcut listener.
 * Uses the capture phase at document level so it runs before
 * xterm.js, Monaco, and DLP hardening handlers.
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      const key = e.key.toLowerCase();

      // Cmd+K — command palette (ALWAYS intercepted, even in terminal)
      if (key === 'k' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        useCommandPaletteStore.getState().toggle();
        return;
      }

      // If inside RDP/VNC, don't intercept anything else
      if (isRemoteViewerFocused()) return;

      // Cmd+B — toggle sidebar
      // Note: shadcn sidebar already handles this internally,
      // but we prevent default here to avoid browser bookmark bar
      if (key === 'b' && !e.shiftKey) {
        e.preventDefault();
        return; // Let the sidebar's own listener handle it
      }

      // Cmd+1 / Cmd+2 — switch connection filter
      const filterMap: Record<string, ConnectionFilter> = {
        '1': 'remote',
        '2': 'database',
      };
      if (filterMap[key]) {
        e.preventDefault();
        e.stopPropagation();
        useUiPreferencesStore.getState().set('workspaceActiveView', filterMap[key]);
        return;
      }

      // Cmd+W — close active tab
      if (key === 'w' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const { activeTabId, closeTab } = useTabsStore.getState();
        if (activeTabId) closeTab(activeTabId);
        return;
      }

      // Cmd+Shift+[ and Cmd+Shift+] — switch tabs
      if (e.shiftKey && (key === '[' || key === ']')) {
        e.preventDefault();
        e.stopPropagation();
        const { tabs, activeTabId, setActiveTab } = useTabsStore.getState();
        if (tabs.length <= 1) return;
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex === -1) return;
        const nextIndex = key === ']'
          ? (currentIndex + 1) % tabs.length
          : (currentIndex - 1 + tabs.length) % tabs.length;
        setActiveTab(tabs[nextIndex].id);
        return;
      }

      // Cmd+= or Cmd+Shift+= — zoom in
      if ((key === '=' || key === '+') && !isMonacoEditorFocused()) {
        e.preventDefault();
        e.stopPropagation();
        const store = useUiPreferencesStore.getState();
        store.set('uiZoomLevel', Math.min(150, store.uiZoomLevel + 10));
        return;
      }

      // Cmd+- — zoom out
      if (key === '-' && !e.shiftKey && !isMonacoEditorFocused()) {
        e.preventDefault();
        e.stopPropagation();
        const store = useUiPreferencesStore.getState();
        store.set('uiZoomLevel', Math.max(80, store.uiZoomLevel - 10));
        return;
      }

      // Cmd+0 — reset zoom
      if (key === '0' && !e.shiftKey && !isMonacoEditorFocused()) {
        e.preventDefault();
        e.stopPropagation();
        useUiPreferencesStore.getState().set('uiZoomLevel', 100);
        return;
      }

      // Cmd+L — lock vault (skip if Monaco editor focused)
      if (key === 'l' && !e.shiftKey && !isMonacoEditorFocused()) {
        e.preventDefault();
        e.stopPropagation();
        useVaultStore.getState().setUnlocked(false);
        broadcastVaultWindowSync('lock');
        void lockVault()
          .catch(() => {
            void useVaultStore.getState().checkStatus();
          });
        return;
      }
    };

    // Use capture phase to run before element-level handlers
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, []);
}
