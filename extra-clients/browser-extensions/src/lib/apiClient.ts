import type { BackgroundMessage, BackgroundResponse } from '../types';

/**
 * Send a message to the background service worker and return the typed response.
 *
 * All API calls are routed through the service worker to bypass CORS restrictions.
 * The popup and options pages should never make direct fetch() calls to Arsenale servers.
 */
export function sendMessage<T = unknown>(
  message: BackgroundMessage,
): Promise<BackgroundResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: BackgroundResponse<T>) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: chrome.runtime.lastError.message ?? 'Unknown extension error',
        });
        return;
      }
      resolve(response ?? { success: false, error: 'No response from background' });
    });
  });
}

/**
 * Convenience wrapper: make an authenticated API request via the service worker.
 */
export function apiRequest<T = unknown>(
  accountId: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<BackgroundResponse<T>> {
  return sendMessage<T>({
    type: 'API_REQUEST',
    accountId,
    method,
    path,
    body,
  });
}

/**
 * Health-check a server URL (unauthenticated).
 */
export function healthCheck(serverUrl: string): Promise<BackgroundResponse<{ status: string; version?: string }>> {
  return sendMessage({ type: 'HEALTH_CHECK', serverUrl });
}

/**
 * Login to a server and create an account entry.
 */
export function login(
  serverUrl: string,
  email: string,
  password: string,
): Promise<BackgroundResponse<{ accountId: string }>> {
  return sendMessage({ type: 'LOGIN', serverUrl, email, password });
}
