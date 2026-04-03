import { getDomainProfile } from '../api/user.api';
import { useAuthStore } from './authStore';

vi.mock('../api/user.api', () => ({
  getDomainProfile: vi.fn(),
}));

const baseUser = {
  id: 'user-1',
  email: 'user@example.com',
  username: 'user',
  avatarData: null,
};

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      accessToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
    });
    vi.clearAllMocks();
  });

  it('stores runtime auth state and persists only the safe subset', () => {
    useAuthStore.getState().setAuth('access-token', 'csrf-token', baseUser);

    const persisted = JSON.parse(localStorage.getItem('arsenale-auth') ?? '{}');

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: 'access-token',
      csrfToken: 'csrf-token',
      user: baseUser,
      isAuthenticated: true,
    });
    expect(persisted.state).toMatchObject({
      csrfToken: 'csrf-token',
      user: baseUser,
      isAuthenticated: true,
    });
    expect(persisted.state.accessToken).toBeUndefined();
  });

  it('merges partial user updates into the current profile', () => {
    useAuthStore.getState().setAuth('access-token', 'csrf-token', baseUser);

    useAuthStore.getState().updateUser({
      username: 'renamed-user',
      avatarData: 'avatar-data',
    });

    expect(useAuthStore.getState().user).toEqual({
      ...baseUser,
      username: 'renamed-user',
      avatarData: 'avatar-data',
    });
  });

  it('hydrates the optional domain profile fields when available', async () => {
    vi.mocked(getDomainProfile).mockResolvedValue({
      domainName: 'corp.example.com',
      domainUsername: 'CORP\\user',
      hasDomainPassword: true,
    });
    useAuthStore.getState().setAuth('access-token', 'csrf-token', baseUser);

    await useAuthStore.getState().fetchDomainProfile();

    expect(useAuthStore.getState().user).toMatchObject({
      ...baseUser,
      domainName: 'corp.example.com',
      domainUsername: 'CORP\\user',
      hasDomainPassword: true,
    });
  });

  it('ignores domain profile failures and clears the session on logout', async () => {
    vi.mocked(getDomainProfile).mockRejectedValue(new Error('boom'));
    useAuthStore.getState().setAuth('access-token', 'csrf-token', baseUser);

    await expect(useAuthStore.getState().fetchDomainProfile()).resolves.toBeUndefined();
    expect(useAuthStore.getState().accessToken).toBe('access-token');

    useAuthStore.getState().logout();

    expect(useAuthStore.getState()).toMatchObject({
      accessToken: null,
      csrfToken: null,
      user: null,
      isAuthenticated: false,
    });
  });
});
