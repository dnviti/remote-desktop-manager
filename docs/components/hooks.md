# Custom Hooks

> Auto-generated on 2026-04-05 by /docs create components.
> Source of truth is the codebase. Run /docs update components after code changes.

### `useAuth` (`client/src/hooks/useAuth.ts`)

Bootstraps authentication on mount. Refreshes access token from cookie if authenticated but token is missing. Redirects to login on failure.

**Returns**: `{ isAuthenticated: boolean, loading: boolean }`

### `useSocket` (`client/src/hooks/useSocket.ts`)

Creates and manages a Socket.IO connection to a given namespace with JWT auth.

**Parameters**: `namespace: string`, `options?: object`
**Returns**: `MutableRefObject<Socket | null>`

### `useSftpTransfers` (`client/src/hooks/useSftpTransfers.ts`)

Manages SFTP file transfer state — tracks uploads/downloads, progress events, chunked upload/download, cancel, clear.

**Returns**: `{ transfers: TransferItem[], uploadFile, downloadFile, cancelTransfer, clearCompleted }`

### `useGatewayMonitor` (`client/src/hooks/useGatewayMonitor.ts`)

Subscribes to `GET /api/gateways/stream` over SSE and applies real-time health, instance, and scaling snapshots to the gateway store. The hook stays disabled until the current user's effective permissions are loaded and `canManageGateways` is true.

**Returns**: void (side-effect hook)

### `useAsyncAction` (`client/src/hooks/useAsyncAction.ts`)

Wraps an async action with loading/error state management. Extracts API errors automatically via `extractApiError`.

**Returns**: `{ loading: boolean, error: string, setError, clearError, run: (action, fallbackError?) => Promise<boolean> }`

### `useCopyToClipboard` (`client/src/hooks/useCopyToClipboard.ts`)

Copies text to the clipboard and tracks a `copied` flag that auto-resets after 2 seconds.

**Returns**: `{ copied: boolean, copy: (text: string) => Promise<void> }`

### `useLazyMount` (`client/src/hooks/useLazyMount.ts`)

Returns `true` once the trigger has been truthy at least once. Used to defer mounting lazy-loaded components until first needed while keeping them mounted for exit animations.

**Parameters**: `trigger: unknown`
**Returns**: `boolean`

### `useShareSync` (`client/src/hooks/useShareSync.ts`)

Subscribes to the notification list store and triggers data refreshes (connections, secrets) when share-related notifications arrive. Debounced per handler type.

**Returns**: void (side-effect hook, mount in MainLayout)

### `useAutoReconnect` (`client/src/hooks/useAutoReconnect.ts`)

Auto-reconnect logic with exponential backoff for dropped sessions. Configurable max retries, delays, and total timeout.

**Parameters**: `connectFn: () => Promise<void>`, `options?: { maxRetries, baseDelayMs, maxDelayMs, totalTimeoutMs }`
**Returns**: `{ reconnectState, attempt, maxRetries, triggerReconnect, cancelReconnect, resetReconnect }`

### `useDlpBrowserHardening` (`client/src/hooks/useDlpBrowserHardening.ts`)

Blocks browser shortcuts used for data exfiltration (DevTools, View Source, Save, Print) and prevents drag-and-drop. Carves out SSH terminal for Ctrl+Shift+C.

**Returns**: void (side-effect hook)

### `useFullscreen` (`client/src/hooks/useFullscreen.ts`)

Tracks fullscreen state scoped to a specific container element, preventing spurious updates from other tabs.

**Parameters**: `containerRef: RefObject<HTMLElement | null>`
**Returns**: `[isFullscreen: boolean, toggleFullscreen: () => void]`

### `useGuacToolbarActions` (`client/src/hooks/useGuacToolbarActions.tsx`)

Builds toolbar action definitions for RDP/VNC viewers (copy, paste, send keys, screenshot, fullscreen, file browser, disconnect). Respects DLP policy restrictions.

**Parameters**: `{ protocol, clientRef, tabId, dlpPolicy, isFullscreen, toggleFullscreen, enableDrive?, fileBrowserOpen?, onToggleDrive? }`
**Returns**: `{ actions: ToolbarAction[], onRemoteClipboard: (text: string) => void }`

### `useKeyboardCapture` (`client/src/hooks/useKeyboardCapture.ts`)

Manages keyboard capture, focus tracking, and fullscreen for session viewer elements. Suppresses browser key defaults for RDP/VNC.

**Parameters**: `{ focusRef, fullscreenRef, isActive, onBlur?, onFocus?, onMouseDown?, onFullscreenChange?, suppressBrowserKeys? }`
**Returns**: `{ isFocused, isFullscreen, enterFullscreen, exitFullscreen, toggleFullscreen }`

### `useDesktopNotifications` (`client/src/hooks/useDesktopNotifications.ts`)

Integrates with the Web Notifications API for desktop push notifications. Requests permission on mount and dispatches browser notifications for share events, recordings, and security alerts when the tab is not focused.

**Returns**: `{ permissionGranted: boolean, requestPermission: () => Promise<void> }`

### `useVaultStatusStream` (`client/src/hooks/useVaultStatusStream.ts`)

Subscribes to the `GET /api/vault/status/stream` SSE endpoint for real-time vault lock/unlock state changes. Updates the vault store on status events.

**Returns**: void (side-effect hook)

<!-- manual-start -->
<!-- manual-end -->
