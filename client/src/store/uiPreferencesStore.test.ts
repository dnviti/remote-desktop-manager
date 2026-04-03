import { useUiPreferencesStore } from './uiPreferencesStore';

describe('useUiPreferencesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiPreferencesStore.setState(useUiPreferencesStore.getInitialState(), true);
  });

  it('sets arbitrary preference keys and persists them', () => {
    useUiPreferencesStore.getState().set('settingsActiveTab', 'notifications');

    expect(useUiPreferencesStore.getState().settingsActiveTab).toBe('notifications');

    const persisted = JSON.parse(localStorage.getItem('arsenale-ui-preferences') ?? '{}');
    expect(persisted.state.settingsActiveTab).toBe('notifications');
  });

  it('toggles boolean preferences', () => {
    expect(useUiPreferencesStore.getState().sidebarCompact).toBe(false);

    useUiPreferencesStore.getState().toggle('sidebarCompact');

    expect(useUiPreferencesStore.getState().sidebarCompact).toBe(true);
  });

  it('toggles team sections from their default expanded state', () => {
    useUiPreferencesStore.getState().toggleTeamSection('team-1');
    expect(useUiPreferencesStore.getState().sidebarTeamSections).toEqual({ 'team-1': false });

    useUiPreferencesStore.getState().toggleTeamSection('team-1');
    expect(useUiPreferencesStore.getState().sidebarTeamSections).toEqual({ 'team-1': true });
  });

  it('toggles keychain folder expansion from its default expanded state', () => {
    useUiPreferencesStore.getState().toggleKeychainFolder('folder-1');

    expect(useUiPreferencesStore.getState().keychainFolderExpandState).toEqual({
      'folder-1': false,
    });
  });
});
