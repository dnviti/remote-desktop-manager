/**
 * Clipboard utilities for the extension popup.
 *
 * Copies a value to the clipboard and schedules an auto-clear alarm that
 * fires after a configurable delay (default 30 seconds). The auto-clear
 * writes an empty string to the clipboard to prevent accidental pastes.
 */

const CLIPBOARD_ALARM = 'clipboard-clear';
const DEFAULT_CLEAR_SECONDS = 30;

/**
 * Copy a text value to the clipboard and schedule auto-clear.
 *
 * @param value - The text to copy.
 * @param clearSeconds - Seconds before the clipboard is cleared (default 30).
 * @returns true if the copy succeeded.
 */
export async function copyToClipboard(
  value: string,
  clearSeconds = DEFAULT_CLEAR_SECONDS,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);

    // Schedule auto-clear via chrome.alarms (survives popup close)
    // chrome.alarms minimum is ~1 minute, but delayInMinutes < 1 is clamped
    // to 1 minute in production. Use the closest we can get.
    const delayMinutes = Math.max(clearSeconds / 60, 0.01);
    await chrome.alarms.create(CLIPBOARD_ALARM, {
      delayInMinutes: delayMinutes,
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the clipboard by writing an empty string.
 * Called by the background service worker when the alarm fires.
 */
export async function clearClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText('');
  } catch {
    // Clipboard API may fail if the document is not focused
  }
}

/** The alarm name used for clipboard auto-clear. */
export const CLIPBOARD_ALARM_NAME = CLIPBOARD_ALARM;
