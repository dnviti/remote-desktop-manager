import { describe, expect, it } from 'vitest';
import {
  extractDomain,
  findMatchingCredentials,
  matchScore,
  type CredentialIndexEntry,
} from './urlMatcher';

function makeEntry(overrides: Partial<CredentialIndexEntry>): CredentialIndexEntry {
  return {
    secretId: 'secret-1',
    name: 'Primary Login',
    accountId: 'account-1',
    ...overrides,
  };
}

describe('urlMatcher', () => {
  it('extracts registrable domains including common two-part tlds', () => {
    expect(extractDomain('login.example.com')).toBe('example.com');
    expect(extractDomain('app.service.co.uk')).toBe('service.co.uk');
    expect(extractDomain('localhost')).toBe('localhost');
  });

  it('prefers explicit url prefix matches over plain domain matches', () => {
    const urlMatch = makeEntry({
      secretId: 'url-match',
      url: 'https://app.example.com/settings',
    });
    const domainMatch = makeEntry({
      secretId: 'domain-match',
      domain: 'example.com',
    });

    expect(matchScore(urlMatch, 'https://app.example.com/settings/profile')).toBe(2);
    expect(matchScore(domainMatch, 'https://app.example.com/settings/profile')).toBe(1);
  });

  it('falls back to the domain parsed from the entry url', () => {
    const entry = makeEntry({
      url: 'https://vault.internal.example.com/login',
    });

    expect(matchScore(entry, 'https://console.internal.example.com')).toBe(1);
  });

  it('returns no match for invalid page urls', () => {
    const entry = makeEntry({ domain: 'example.com' });

    expect(matchScore(entry, 'not a url')).toBe(0);
  });

  it('returns matching credentials sorted by score', () => {
    const matches = findMatchingCredentials(
      [
        makeEntry({ secretId: 'domain', domain: 'example.com' }),
        makeEntry({ secretId: 'exact', url: 'https://app.example.com/login' }),
        makeEntry({ secretId: 'other', domain: 'other.net' }),
      ],
      'https://app.example.com/login/team'
    );

    expect(matches.map((entry) => entry.secretId)).toEqual(['exact', 'domain']);
  });
});
