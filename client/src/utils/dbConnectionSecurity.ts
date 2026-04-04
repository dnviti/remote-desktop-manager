import type { DbCloudProvider, DbProtocol } from '../api/connections.api';

export interface DbTLSModeOption {
  value: string;
  label: string;
  helperText: string;
}

export function supportsCloudProviderPresets(protocol?: DbProtocol): boolean {
  return protocol === 'postgresql' || protocol === 'mysql';
}

export function normalizeCloudProviderSelection(value: string): DbCloudProvider | undefined {
  switch (value) {
    case 'azure':
    case 'aws':
    case 'gcp':
      return value;
    default:
      return undefined;
  }
}

export function recommendedSSLMode(
  protocol?: DbProtocol,
  provider?: DbCloudProvider,
): string | undefined {
  if (!supportsCloudProviderPresets(protocol)) {
    return undefined;
  }
  switch (provider) {
    case 'azure':
    case 'aws':
    case 'gcp':
      return 'require';
    default:
      return undefined;
  }
}

export function nextSSLModeForCloudProvider(
  protocol: DbProtocol | undefined,
  currentMode: string | undefined,
  previousProvider: DbCloudProvider | undefined,
  nextProvider: DbCloudProvider | undefined,
): string | undefined {
  const normalizedCurrent = normalizeOptionalString(currentMode);
  const previousRecommended = recommendedSSLMode(protocol, previousProvider);
  if (!normalizedCurrent || normalizedCurrent === previousRecommended) {
    return recommendedSSLMode(protocol, nextProvider);
  }
  return normalizedCurrent;
}

export function cloudProviderHint(
  protocol?: DbProtocol,
  provider?: DbCloudProvider,
): string | undefined {
  if (!provider || !supportsCloudProviderPresets(protocol)) {
    return undefined;
  }

  const providerName = cloudProviderLabel(provider);
  if (protocol === 'postgresql') {
    return `${providerName} managed PostgreSQL usually works with TLS Required. Use Verify full if you connect with the provider hostname and want strict hostname validation.`;
  }
  if (protocol === 'mysql') {
    return `${providerName} managed MySQL usually works with TLS Required. Use Skip verification only when the CA chain is private or temporarily broken.`;
  }
  return undefined;
}

export function tlsModeOptions(protocol?: DbProtocol): DbTLSModeOption[] {
  switch (protocol) {
    case 'postgresql':
      return [
        {
          value: '',
          label: 'Driver default',
          helperText: 'Leave sslmode unset and let the PostgreSQL driver choose its default behaviour.',
        },
        {
          value: 'disable',
          label: 'Disabled',
          helperText: 'Never use TLS.',
        },
        {
          value: 'prefer',
          label: 'If available',
          helperText: 'Try TLS first, but allow non-TLS when the server does not require it.',
        },
        {
          value: 'require',
          label: 'Required',
          helperText: 'Always use TLS, without enforcing CA or hostname verification.',
        },
        {
          value: 'verify-ca',
          label: 'Verify CA',
          helperText: 'Require TLS and validate the server certificate chain.',
        },
        {
          value: 'verify-full',
          label: 'Verify full',
          helperText: 'Require TLS, validate the certificate chain, and verify the hostname.',
        },
      ];
    case 'mysql':
      return [
        {
          value: '',
          label: 'Driver default',
          helperText: 'Keep the current connector default for MySQL/MariaDB connections.',
        },
        {
          value: 'disable',
          label: 'Disabled',
          helperText: 'Never use TLS.',
        },
        {
          value: 'prefer',
          label: 'If available',
          helperText: 'Attempt TLS first and allow plaintext fallback when the server permits it.',
        },
        {
          value: 'require',
          label: 'Required',
          helperText: 'Always use TLS and validate the certificate against system trust roots.',
        },
        {
          value: 'skip-verify',
          label: 'Required (skip verification)',
          helperText: 'Always use TLS but skip certificate validation. Use only as a last resort.',
        },
      ];
    default:
      return [];
  }
}

function cloudProviderLabel(provider: DbCloudProvider): string {
  switch (provider) {
    case 'azure':
      return 'Azure';
    case 'aws':
      return 'AWS';
    case 'gcp':
      return 'GCP';
  }
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
