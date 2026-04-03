import { validateDbFirewallPattern } from './dbFirewallPattern';

describe('validateDbFirewallPattern', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects nested quantifiers without compiling the pattern', () => {
    const nativeRegExp = globalThis.RegExp;
    const regExpSpy = vi.fn(function RegExpSpy(pattern: string | RegExp, flags?: string) {
      return new nativeRegExp(pattern, flags);
    });
    vi.stubGlobal('RegExp', regExpSpy);

    expect(validateDbFirewallPattern('(a+)+$')).toBe('Pattern is too complex or too long');
    expect(regExpSpy).not.toHaveBeenCalled();
  });

  it('defers full regex syntax validation to the backend', () => {
    const nativeRegExp = globalThis.RegExp;
    const regExpSpy = vi.fn(function RegExpSpy(pattern: string | RegExp, flags?: string) {
      return new nativeRegExp(pattern, flags);
    });
    vi.stubGlobal('RegExp', regExpSpy);

    expect(validateDbFirewallPattern('(')).toBeNull();
    expect(regExpSpy).not.toHaveBeenCalled();
  });
});
