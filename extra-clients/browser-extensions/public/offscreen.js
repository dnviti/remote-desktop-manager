(async () => {
  try {
    await navigator.clipboard.writeText('');
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_CLIPBOARD_CLEARED' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_CLIPBOARD_ERROR',
      error: message,
    });
  }
})();
