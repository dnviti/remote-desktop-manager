async function loadThemeStore(prefersLight: boolean) {
  vi.resetModules();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: prefersLight,
      media: '(prefers-color-scheme: light)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  return (await import('./themeStore')).useThemeStore;
}

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes from the system light preference', async () => {
    const useThemeStore = await loadThemeStore(true);

    expect(useThemeStore.getState()).toMatchObject({
      themeName: 'editorial',
      mode: 'light',
    });
  });

  it('toggles mode and persists explicit theme selections', async () => {
    const useThemeStore = await loadThemeStore(false);

    expect(useThemeStore.getState().mode).toBe('dark');

    useThemeStore.getState().toggle();
    useThemeStore.getState().setTheme('primer');
    useThemeStore.getState().setMode('dark');

    expect(useThemeStore.getState()).toMatchObject({
      themeName: 'primer',
      mode: 'dark',
    });

    const persisted = JSON.parse(localStorage.getItem('arsenale-theme') ?? '{}');
    expect(persisted.state).toMatchObject({
      themeName: 'primer',
      mode: 'dark',
    });
  });
});
