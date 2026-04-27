import { classifyQueryType, defaultSessionConfigForProtocol, stripLeadingComments } from './dbWorkspaceBehavior';

describe('dbWorkspaceBehavior', () => {
  it('strips leading comments before classifying queries', () => {
    expect(stripLeadingComments('-- explain next\nselect * from users')).toBe('select * from users');
    expect(stripLeadingComments('/* migration */\nupdate users set name = ?')).toBe('update users set name = ?');
  });

  it('classifies workspace query actions', () => {
    expect(classifyQueryType('select * from users')).toBe('SELECT');
    expect(classifyQueryType('with q as (select 1) update users set name = q.x')).toBe('UPDATE');
    expect(classifyQueryType('merge into users using incoming on users.id = incoming.id')).toBe('UPDATE');
    expect(classifyQueryType('call refresh_stats()')).toBe('EXEC');
  });

  it('derives protocol session defaults', () => {
    expect(defaultSessionConfigForProtocol('postgresql', 'app')).toMatchObject({
      activeDatabase: 'app',
      searchPath: 'public',
    });
    expect(defaultSessionConfigForProtocol('mssql', 'app')).toEqual({ activeDatabase: 'app' });
    expect(defaultSessionConfigForProtocol('mongodb', 'app')).toEqual({});
  });
});
