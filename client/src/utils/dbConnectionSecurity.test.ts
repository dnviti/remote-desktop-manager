import { describe, expect, it } from 'vitest';

import {
  cloudProviderHint,
  nextSSLModeForCloudProvider,
  recommendedSSLMode,
  remapSSLModeOnProtocolChange,
  sanitizeSSLModeForProtocol,
  tlsModeOptions,
} from './dbConnectionSecurity';

describe('dbConnectionSecurity', () => {
  it('recommends TLS required for managed MySQL and PostgreSQL providers', () => {
    expect(recommendedSSLMode('postgresql', 'azure')).toBe('require');
    expect(recommendedSSLMode('postgresql', 'aws')).toBe('require');
    expect(recommendedSSLMode('mysql', 'gcp')).toBe('require');
    expect(recommendedSSLMode('mysql', undefined)).toBeUndefined();
  });

  it('updates the TLS mode when the previous value matched the prior provider recommendation', () => {
    expect(
      nextSSLModeForCloudProvider('postgresql', 'require', 'azure', 'aws'),
    ).toBe('require');
    expect(
      nextSSLModeForCloudProvider('mysql', undefined, undefined, 'gcp'),
    ).toBe('require');
  });

  it('keeps manual TLS overrides when changing provider presets', () => {
    expect(
      nextSSLModeForCloudProvider('postgresql', 'verify-full', 'azure', 'aws'),
    ).toBe('verify-full');
    expect(
      nextSSLModeForCloudProvider('mysql', 'skip-verify', 'azure', 'gcp'),
    ).toBe('skip-verify');
  });

  it('keeps the current mode when moving back to the generic preset', () => {
    expect(
      nextSSLModeForCloudProvider('mysql', 'require', 'azure', undefined),
    ).toBe('require');
  });

  it('returns protocol-specific TLS options', () => {
    expect(tlsModeOptions('postgresql').map((option) => option.value)).toEqual([
      '',
      'disable',
      'prefer',
      'require',
      'verify-ca',
      'verify-full',
    ]);
    expect(tlsModeOptions('mysql').map((option) => option.value)).toEqual([
      '',
      'disable',
      'prefer',
      'require',
      'skip-verify',
    ]);
  });

  it('shows provider guidance only for cloud-managed SQL protocols', () => {
    expect(cloudProviderHint('postgresql', 'azure')).toContain('Azure');
    expect(cloudProviderHint('mysql', 'aws')).toContain('AWS');
    expect(cloudProviderHint('mongodb', 'gcp')).toBeUndefined();
    expect(cloudProviderHint('postgresql', undefined)).toBeUndefined();
  });

  it('sanitizes invalid TLS modes when switching between cloud SQL protocols', () => {
    expect(
      sanitizeSSLModeForProtocol('mysql', 'verify-full'),
    ).toBeUndefined();
    expect(
      sanitizeSSLModeForProtocol('mysql', 'verify-full', 'azure'),
    ).toBe('require');
    expect(
      sanitizeSSLModeForProtocol('mssql', 'require'),
    ).toBe('require');
  });

  it('clears hidden TLS state when leaving cloud SQL protocols', () => {
    expect(
      remapSSLModeOnProtocolChange('postgresql', 'oracle', 'require'),
    ).toBeUndefined();
    expect(
      remapSSLModeOnProtocolChange('mssql', 'oracle', 'require'),
    ).toBe('require');
  });
});
