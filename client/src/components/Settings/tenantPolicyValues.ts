export interface TenantPolicyPatch {
  defaultSessionTimeoutSeconds?: number;
  recordingRetentionDays?: number | null;
  userDriveQuotaBytes?: number | null;
}

export interface TenantPolicyParseResult {
  patch?: TenantPolicyPatch;
  error?: string;
}

export function formatMegabytes(bytes: number | null | undefined) {
  if (bytes == null) return 'System default';
  return `${parseFloat((bytes / 1048576).toFixed(2))} MB`;
}

export function parseSessionTimeoutPatch(value: string): TenantPolicyParseResult {
  const minutes = Number.parseInt(value, 10);
  if (Number.isNaN(minutes) || minutes < 1 || minutes > 1440) {
    return { error: 'Choose a timeout between 1 and 1440 minutes.' };
  }
  return { patch: { defaultSessionTimeoutSeconds: minutes * 60 } };
}

export function parseRecordingRetentionPatch(value: string): TenantPolicyParseResult {
  const nextValue = value.trim() === '' ? null : Number.parseInt(value, 10);
  if (nextValue !== null && (Number.isNaN(nextValue) || nextValue < 1 || nextValue > 3650)) {
    return { error: 'Retention must be between 1 and 3650 days.' };
  }
  return { patch: { recordingRetentionDays: nextValue } };
}

export function parseUserDriveQuotaPatch(value: string): TenantPolicyParseResult {
  const driveQuota = value.trim() === '' ? null : Math.round(Number.parseFloat(value) * 1048576);
  if (driveQuota !== null && (Number.isNaN(driveQuota) || driveQuota < 1)) {
    return { error: 'Drive quota must be a positive number.' };
  }
  return { patch: { userDriveQuotaBytes: driveQuota } };
}
