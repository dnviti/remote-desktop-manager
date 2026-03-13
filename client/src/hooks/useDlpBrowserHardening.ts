import { useEffect } from 'react';

/**
 * Blocks browser shortcuts used for data exfiltration:
 * DevTools (F12, Ctrl+Shift+I/J/C on Win/Linux; Cmd+Alt+I/J/C on macOS),
 * View Source (Ctrl+U / Cmd+U / Cmd+Alt+U), Save (Ctrl/Cmd+S), Print (Ctrl/Cmd+P).
 * Also prevents drag-and-drop to external apps.
 *
 * Uses e.code for layout- and case-independent key matching.
 * Ctrl+Shift+C / Cmd+Shift+C is carved out when an SSH terminal is focused so
 * the terminal's own copy handler (which respects DLP disableCopy) can process it.
 */
export function useDlpBrowserHardening(): void {
  useEffect(() => {
    /** Suppress element-picker shortcut, with SSH terminal carve-out. */
    const blockElementPicker = (e: KeyboardEvent): boolean => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.closest('[data-viewer-type="ssh"]')) {
        return false; // let SSH terminal handle it
      }
      e.preventDefault();
      e.stopPropagation();
      return true;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // F12 — DevTools toggle (all platforms)
      if (e.key === 'F12') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      // macOS: Cmd+Alt+I/J — DevTools Inspector / Console
      //        Cmd+Alt+C   — Element picker (SSH carve-out)
      //        Cmd+Alt+U   — View Source (Chrome/Safari variant)
      if (e.metaKey && e.altKey && !e.shiftKey) {
        if (e.code === 'KeyI' || e.code === 'KeyJ') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.code === 'KeyC') {
          blockElementPicker(e);
          return;
        }
        if (e.code === 'KeyU') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // Win/Linux: Ctrl+Shift+I — DevTools Inspector
      //            Ctrl+Shift+J — DevTools Console
      //            Ctrl+Shift+C — Element picker (SSH carve-out)
      // macOS:     Cmd+Shift+C  — Element picker (SSH carve-out)
      if (e.shiftKey && !e.altKey) {
        if (e.code === 'KeyI' || e.code === 'KeyJ') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.code === 'KeyC') {
          blockElementPicker(e);
          return;
        }
      }

      // Ctrl/Cmd-only combos (no shift, no alt):
      // Ctrl+U / Cmd+U — View Source
      // Ctrl+S / Cmd+S — Save Page
      // Ctrl+P / Cmd+P — Print
      if (!e.shiftKey && !e.altKey) {
        if (e.code === 'KeyU' || e.code === 'KeyS' || e.code === 'KeyP') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('dragstart', handleDragStart, { capture: true });

    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('dragstart', handleDragStart, { capture: true });
    };
  }, []);
}
