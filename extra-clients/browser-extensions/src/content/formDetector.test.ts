// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLoginForms, watchForLoginForms } from './formDetector';

function markVisible(element: HTMLElement): void {
  Object.defineProperty(element, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
}

describe('formDetector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('detects username and password fields inside a login form', () => {
    document.body.innerHTML = `
      <form>
        <input type="email" id="email" />
        <input type="password" id="password" />
      </form>
    `;
    markVisible(document.getElementById('email') as HTMLElement);
    markVisible(document.getElementById('password') as HTMLElement);

    const [detected] = detectLoginForms();

    expect(detected?.usernameInput?.id).toBe('email');
    expect(detected?.passwordInput.id).toBe('password');
  });

  it('watches for dynamically inserted login forms', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const disconnect = watchForLoginForms(callback);

    document.body.innerHTML = '<div id="root"></div>';
    document.getElementById('root')?.insertAdjacentHTML(
      'beforeend',
      `
        <form>
          <input type="text" id="username" autocomplete="username" />
          <input type="password" id="password" />
        </form>
      `,
    );
    markVisible(document.getElementById('username') as HTMLElement);
    markVisible(document.getElementById('password') as HTMLElement);

    await vi.advanceTimersByTimeAsync(500);

    expect(callback).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          passwordInput: expect.objectContaining({ id: 'password' }),
        }),
      ]),
    );

    disconnect();
  });
});
