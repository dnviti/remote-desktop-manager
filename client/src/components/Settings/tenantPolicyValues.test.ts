import {
  formatMegabytes,
  parseRecordingRetentionPatch,
  parseSessionTimeoutPatch,
  parseUserDriveQuotaPatch,
} from './tenantPolicyValues';

describe('tenantPolicyValues', () => {
  it('formats nullable byte quotas as operator-facing megabytes', () => {
    expect(formatMegabytes(null)).toBe('System default');
    expect(formatMegabytes(104857600)).toBe('100 MB');
    expect(formatMegabytes(1572864)).toBe('1.5 MB');
  });

  it('parses default session timeout in minutes into seconds', () => {
    expect(parseSessionTimeoutPatch('30')).toEqual({
      patch: { defaultSessionTimeoutSeconds: 1800 },
    });
    expect(parseSessionTimeoutPatch('0')).toEqual({
      error: 'Choose a timeout between 1 and 1440 minutes.',
    });
  });

  it('parses recording retention with blank system default support', () => {
    expect(parseRecordingRetentionPatch('')).toEqual({
      patch: { recordingRetentionDays: null },
    });
    expect(parseRecordingRetentionPatch('90')).toEqual({
      patch: { recordingRetentionDays: 90 },
    });
    expect(parseRecordingRetentionPatch('3651')).toEqual({
      error: 'Retention must be between 1 and 3650 days.',
    });
  });

  it('parses user drive quota megabytes into bytes', () => {
    expect(parseUserDriveQuotaPatch('')).toEqual({
      patch: { userDriveQuotaBytes: null },
    });
    expect(parseUserDriveQuotaPatch('1.5')).toEqual({
      patch: { userDriveQuotaBytes: 1572864 },
    });
    expect(parseUserDriveQuotaPatch('-1')).toEqual({
      error: 'Drive quota must be a positive number.',
    });
  });
});
