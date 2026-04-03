import { addRecentConnection, getRecentConnectionIds } from './recentConnections';

describe('recentConnections', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('stores the most recent connections first and removes duplicates', () => {
    addRecentConnection('user-1', 'conn-1');
    vi.setSystemTime(new Date('2024-01-02T03:04:06.000Z'));
    addRecentConnection('user-1', 'conn-2');
    vi.setSystemTime(new Date('2024-01-02T03:04:07.000Z'));
    addRecentConnection('user-1', 'conn-1');

    expect(getRecentConnectionIds('user-1')).toEqual(['conn-1', 'conn-2']);
  });

  it('keeps only the 10 most recent connections', () => {
    for (let i = 0; i < 12; i += 1) {
      vi.setSystemTime(new Date(`2024-01-02T03:04:${String(i).padStart(2, '0')}.000Z`));
      addRecentConnection('user-1', `conn-${i}`);
    }

    expect(getRecentConnectionIds('user-1')).toEqual([
      'conn-11',
      'conn-10',
      'conn-9',
      'conn-8',
      'conn-7',
      'conn-6',
      'conn-5',
      'conn-4',
      'conn-3',
      'conn-2',
    ]);
  });

  it('returns an empty list for invalid storage and swallows storage write errors', () => {
    localStorage.setItem('arsenale-recent-connections-user-1', 'not-json');

    expect(getRecentConnectionIds('user-1')).toEqual([]);

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    expect(() => addRecentConnection('user-1', 'conn-1')).not.toThrow();
  });
});
