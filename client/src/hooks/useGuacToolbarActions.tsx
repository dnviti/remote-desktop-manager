import { useMemo, useCallback, useRef } from 'react';
import {
  Copy,
  ClipboardPaste,
  Keyboard,
  Camera,
  Maximize,
  Minimize,
  FolderOpen,
  Power,
} from 'lucide-react';
import * as Guacamole from '@glokon/guacamole-common-js';
import type { ToolbarAction } from '../components/shared/DockedToolbar';
import type { ResolvedDlpPolicy } from '../api/connections.api';
import { KEYSYMS } from '../constants/keysyms';
import { closeConnectionSurface } from '../utils/closeConnectionSurface';

interface UseGuacToolbarActionsOptions {
  protocol: 'RDP' | 'VNC';
  clientRef: React.RefObject<Guacamole.Client | null>;
  tabId: string;
  dlpPolicy: ResolvedDlpPolicy | null;
  isFullscreen: boolean;
  toggleFullscreen: () => void | Promise<void>;
  // RDP-only
  enableDrive?: boolean;
  fileBrowserOpen?: boolean;
  onToggleDrive?: () => void;
}

export interface UseGuacToolbarActionsResult {
  actions: ToolbarAction[];
  /** Call this with the text received from the remote onclipboard event */
  onRemoteClipboard: (text: string) => void;
}

export function useGuacToolbarActions({
  protocol,
  clientRef,
  tabId,
  dlpPolicy,
  isFullscreen,
  toggleFullscreen,
  enableDrive = false,
  fileBrowserOpen = false,
  onToggleDrive,
}: UseGuacToolbarActionsOptions): UseGuacToolbarActionsResult {

  const lastRemoteClipboardRef = useRef<string>('');

  const sendKeys = useCallback((keysyms: readonly number[]) => {
    const client = clientRef.current;
    if (!client) return;
    keysyms.forEach((k) => client.sendKeyEvent(1, k));
    [...keysyms].reverse().forEach((k) => client.sendKeyEvent(0, k));
  }, [clientRef]);

  const onRemoteClipboard = useCallback((text: string) => {
    lastRemoteClipboardRef.current = text;
  }, []);

  const handleCopy = useCallback(() => {
    // Write the last received remote clipboard content to the local clipboard.
    const text = lastRemoteClipboardRef.current;
    if (!text || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).catch((err) => {
      console.warn('Failed to write remote clipboard to browser clipboard:', err);
    });
  }, []);

  const handlePaste = useCallback(() => {
    const client = clientRef.current;
    if (!client || !navigator.clipboard?.readText) return;
    navigator.clipboard.readText().then((text) => {
      if (!text) return;
      const stream = client.createClipboardStream('text/plain');
      const writer = new Guacamole.StringWriter(stream);
      writer.sendText(text);
      writer.sendEnd();
    }).catch((err) => {
      console.warn('Failed to read browser clipboard:', err);
    });
  }, [clientRef]);

  const handleScreenshot = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    const canvas = client.getDisplay().flatten();
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `screenshot-${Date.now()}.png`;
    link.click();
  }, [clientRef]);

  const handleDisconnect = useCallback(() => {
    closeConnectionSurface(tabId);
  }, [tabId]);

  const driveHiddenByDlp = dlpPolicy?.disableDownload && dlpPolicy?.disableUpload;

  /* eslint-disable react-hooks/refs -- callbacks capture clientRef but only read .current on click, never during render */
  const actions = useMemo<ToolbarAction[]>(() => {
    const list: ToolbarAction[] = [];

    // Clipboard: Copy
    list.push({
      id: 'clipboard-copy',
      icon: <Copy className="size-4" />,
      tooltip: 'Copy',
      onClick: handleCopy,
      disabled: !!dlpPolicy?.disableCopy,
    });

    // Clipboard: Paste
    list.push({
      id: 'clipboard-paste',
      icon: <ClipboardPaste className="size-4" />,
      tooltip: 'Paste',
      onClick: handlePaste,
      disabled: !!dlpPolicy?.disablePaste,
    });

    // Ctrl+Alt+Del
    list.push({
      id: 'ctrl-alt-del',
      icon: <Keyboard className="size-4" />,
      tooltip: 'Ctrl+Alt+Del',
      onClick: () => sendKeys(KEYSYMS.CTRL_ALT_DEL),
    });

    // Send Keys submenu
    list.push({
      id: 'send-keys',
      icon: <Keyboard className="size-4" />,
      tooltip: 'Send Keys',
      onClick: () => {},
      subActions: [
        { id: 'alt-tab', icon: <Keyboard className="size-4" />, tooltip: 'Alt+Tab', onClick: () => sendKeys(KEYSYMS.ALT_TAB) },
        { id: 'alt-f4', icon: <Keyboard className="size-4" />, tooltip: 'Alt+F4', onClick: () => sendKeys(KEYSYMS.ALT_F4) },
        { id: 'windows-key', icon: <Keyboard className="size-4" />, tooltip: 'Windows Key', onClick: () => sendKeys(KEYSYMS.WINDOWS) },
        { id: 'print-screen', icon: <Keyboard className="size-4" />, tooltip: 'PrintScreen', onClick: () => sendKeys(KEYSYMS.PRINT_SCREEN) },
      ],
    });

    // Screenshot
    list.push({
      id: 'screenshot',
      icon: <Camera className="size-4" />,
      tooltip: 'Screenshot',
      onClick: handleScreenshot,
      hidden: !!dlpPolicy?.disableDownload,
    });

    // Fullscreen
    list.push({
      id: 'fullscreen',
      icon: isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />,
      tooltip: isFullscreen ? 'Exit Fullscreen' : 'Fullscreen',
      onClick: toggleFullscreen,
      active: isFullscreen,
    });

    // Shared Drive (RDP only)
    if (protocol === 'RDP') {
      list.push({
        id: 'shared-drive',
        icon: <FolderOpen className="size-4" />,
        tooltip: fileBrowserOpen ? 'Close Shared Drive' : 'Open Shared Drive',
        onClick: () => onToggleDrive?.(),
        active: fileBrowserOpen,
        hidden: !enableDrive || !!driveHiddenByDlp,
      });
    }

    // Disconnect
    list.push({
      id: 'disconnect',
      icon: <Power className="size-4" />,
      tooltip: 'Disconnect',
      onClick: handleDisconnect,
      color: 'error.main',
    });

    return list;
  }, [
    protocol, dlpPolicy, isFullscreen, toggleFullscreen,
    enableDrive, fileBrowserOpen, driveHiddenByDlp,
    handleCopy, handlePaste, handleScreenshot, handleDisconnect, sendKeys,
    onToggleDrive,
  ]);
  /* eslint-enable react-hooks/refs */

  return { actions, onRemoteClipboard };
}
