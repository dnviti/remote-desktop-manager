import type { TenantUser } from '../../api/tenant.api';
import { ROLE_LABELS, type TenantRole } from '../../utils/roles';

export function getMemberName(user: TenantUser) {
  return user.username || user.email;
}

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

export function formatExpiry(user: TenantUser) {
  if (!user.expiresAt) return 'No expiration';
  const label = formatDate(user.expiresAt);
  return user.expired ? `Expired ${label}` : `Expires ${label}`;
}

export function getMfaLabel(user: TenantUser) {
  const methods = [
    user.totpEnabled ? 'TOTP' : null,
    user.smsMfaEnabled ? 'SMS' : null,
  ].filter(Boolean);

  return methods.length > 0 ? methods.join(' + ') : 'No MFA';
}

export function getMemberSearchText(user: TenantUser) {
  return [
    getMemberName(user),
    user.email,
    ROLE_LABELS[user.role as TenantRole] ?? user.role,
    user.pending ? 'pending invite' : null,
    user.enabled === false ? 'disabled' : 'active',
    getMfaLabel(user),
    formatExpiry(user),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getColumnAriaSort(
  isSortable: boolean,
  sortState: false | 'asc' | 'desc',
): 'ascending' | 'descending' | 'none' | undefined {
  if (!isSortable) return undefined;
  if (sortState === 'asc') return 'ascending';
  if (sortState === 'desc') return 'descending';
  return 'none';
}

export function getColumnClassName(columnId: string) {
  switch (columnId) {
    case 'member':
      return 'min-w-[20rem] max-w-[24rem] whitespace-normal';
    case 'role':
      return 'min-w-[13rem]';
    case 'status':
      return 'min-w-[18rem] whitespace-normal';
    case 'expiry':
    case 'security':
      return 'min-w-[13rem] whitespace-normal';
    case 'permissions':
    case 'enabled':
      return 'min-w-[11rem]';
    case 'actions':
      return 'w-[4rem] text-right';
    default:
      return undefined;
  }
}
