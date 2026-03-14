import { useCallback, useEffect, useRef, useState } from 'react';

interface UseKeyboardCaptureOptions {
  /** Element for focus management and keyboard capture */
  focusRef: React.RefObject<HTMLElement | null>;
  /** Element for fullscreen (typically the outer container) */
  fullscreenRef: React.RefObject<HTMLElement | null>;
  /** Whether this viewer tab is currently active */
  isActive: boolean;
  /** Called on blur — viewers use this to reset keyboard state */
  onBlur?: () => void;
  /** Called on focus — viewers use this for clipboard sync */
  onFocus?: () => void;
  /** Called on mousedown — viewers use this for clipboard sync */
  onMouseDown?: () => void;
  /** Called when fullscreen state changes */
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /** Whether to suppress browser key defaults at capture phase (true for RDP/VNC, false for SSH) */
  suppressBrowserKeys?: boolean;
}

interface UseKeyboardCaptureReturn {
  isFocused: boolean;
  isFullscreen: boolean;
  enterFullscreen: () => Promise<void>;
  exitFullscreen: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
}

export function useKeyboardCapture({
  focusRef,
  fullscreenRef,
  isActive,
  onBlur,
  onFocus,
  onMouseDown,
  onFullscreenChange,
  suppressBrowserKeys = false,
}: UseKeyboardCaptureOptions): UseKeyboardCaptureReturn {
  const [isFocused, setIsFocused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Tracks whether this hook instance successfully acquired the Keyboard Lock
  const lockAcquiredRef = useRef(false);

  // Keep callbacks in refs to avoid re-attaching listeners
  const onBlurRef = useRef(onBlur);
  const onFocusRef = useRef(onFocus);
  const onMouseDownRef = useRef(onMouseDown);
  const onFullscreenChangeRef = useRef(onFullscreenChange);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    onBlurRef.current = onBlur;
    onFocusRef.current = onFocus;
    onMouseDownRef.current = onMouseDown;
    onFullscreenChangeRef.current = onFullscreenChange;
    isActiveRef.current = isActive;
  });

  // Handle isActive changes — blur and reset when tab becomes inactive
  useEffect(() => {
    if (!isActive) {
      onBlurRef.current?.();
      focusRef.current?.blur();
    }
  }, [isActive, focusRef]);

  // Focus management: mouseenter, mouseleave, blur, focus, mousedown
  useEffect(() => {
    const el = focusRef.current;
    if (!el) return;

    const handleMouseEnter = () => {
      if (isActiveRef.current) el.focus();
    };
    const handleMouseLeave = () => {
      onBlurRef.current?.();
      el.blur();
    };
    const handleBlur = () => {
      onBlurRef.current?.();
      setIsFocused(false);
    };
    const handleFocus = () => {
      onFocusRef.current?.();
      setIsFocused(true);
    };
    const handleMouseDown = () => {
      if (isActiveRef.current) el.focus();
      onMouseDownRef.current?.();
    };

    el.addEventListener('mouseenter', handleMouseEnter);
    el.addEventListener('mouseleave', handleMouseLeave);
    el.addEventListener('blur', handleBlur);
    el.addEventListener('focus', handleFocus);
    el.addEventListener('mousedown', handleMouseDown);

    return () => {
      el.removeEventListener('mouseenter', handleMouseEnter);
      el.removeEventListener('mouseleave', handleMouseLeave);
      el.removeEventListener('blur', handleBlur);
      el.removeEventListener('focus', handleFocus);
      el.removeEventListener('mousedown', handleMouseDown);
    };
  }, [focusRef]);

  // Capture-phase keyboard interception (RDP/VNC only)
  useEffect(() => {
    if (!suppressBrowserKeys) return;
    const el = focusRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      // preventDefault stops the browser's default action (e.g. Ctrl+L opening address bar)
      // stopPropagation prevents parent elements from seeing the event
      // Guacamole.Keyboard listeners on the same element still fire
      e.preventDefault();
      e.stopPropagation();
    };

    el.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => el.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [focusRef, suppressBrowserKeys]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsEl = fullscreenRef.current;
      const nowFullscreen = document.fullscreenElement === fsEl;
      setIsFullscreen(nowFullscreen);
      onFullscreenChangeRef.current?.(nowFullscreen);

      // Only unlock when the document has fully exited fullscreen
      // and this hook instance actually acquired the lock
      if (document.fullscreenElement === null) {
        if (lockAcquiredRef.current) {
          try {
            navigator.keyboard?.unlock();
          } catch {
            // Keyboard Lock API not supported
          }
          lockAcquiredRef.current = false;
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [fullscreenRef]);

  const enterFullscreen = useCallback(async () => {
    const el = fullscreenRef.current;
    if (!el || document.fullscreenElement) return;
    try {
      await el.requestFullscreen();
      // Attempt to lock keyboard (Chromium-only, feature-detected)
      if (navigator.keyboard?.lock) {
        try {
          await navigator.keyboard.lock();
          lockAcquiredRef.current = true;
        } catch {
          // Keyboard Lock not supported or denied — fullscreen still works
        }
      }
    } catch {
      // Fullscreen request failed (e.g. not triggered by user gesture)
    }
  }, [fullscreenRef]);

  const exitFullscreen = useCallback(async () => {
    if (!document.fullscreenElement) return;
    try {
      navigator.keyboard?.unlock();
      lockAcquiredRef.current = false;
    } catch {
      // Keyboard Lock API not supported or failed
    }
    try {
      await document.exitFullscreen();
    } catch {
      // Already exited
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  // Cleanup: exit fullscreen and unlock keyboard on unmount
  useEffect(() => {
    const fsEl = fullscreenRef.current;
    return () => {
      // Only unlock if this instance acquired the lock
      if (lockAcquiredRef.current) {
        try {
          navigator.keyboard?.unlock();
        } catch {
          // ignore
        }
        lockAcquiredRef.current = false;
      }
      if (document.fullscreenElement === fsEl) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [fullscreenRef]);

  return { isFocused, isFullscreen, enterFullscreen, exitFullscreen, toggleFullscreen };
}
