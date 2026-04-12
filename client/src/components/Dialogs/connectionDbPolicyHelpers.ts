import type { DbPolicyOverrideMode } from '../../api/connections.api';

export const CONNECTION_DB_POLICY_MODE_OPTIONS: Array<{
  value: DbPolicyOverrideMode;
  label: string;
  description: string;
}> = [
  {
    value: 'inherit',
    label: 'Tenant defaults',
    description: 'Use only the tenant-wide policies configured in Settings.',
  },
  {
    value: 'merge',
    label: 'Merge',
    description: 'Apply this connection’s policies before the tenant-wide policies.',
  },
  {
    value: 'override',
    label: 'Connection only',
    description: 'Use only this connection’s policies and ignore tenant-wide policies.',
  },
];

export function createConnectionPolicyId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function trimOptionalText(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
