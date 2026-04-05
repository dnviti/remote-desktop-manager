export type PermissionFlag =
  | 'canConnect'
  | 'canCreateConnections'
  | 'canManageConnections'
  | 'canViewCredentials'
  | 'canShareConnections'
  | 'canViewAuditLog'
  | 'canManageSessions'
  | 'canManageGateways'
  | 'canManageUsers'
  | 'canManageSecrets'
  | 'canManageTenantSettings';

export const ALL_PERMISSION_FLAGS: PermissionFlag[] = [
  'canConnect',
  'canCreateConnections',
  'canManageConnections',
  'canViewCredentials',
  'canShareConnections',
  'canViewAuditLog',
  'canManageSessions',
  'canManageGateways',
  'canManageUsers',
  'canManageSecrets',
  'canManageTenantSettings',
];

export function emptyPermissionFlags(): Record<PermissionFlag, boolean> {
  return ALL_PERMISSION_FLAGS.reduce((acc, flag) => {
    acc[flag] = false;
    return acc;
  }, {} as Record<PermissionFlag, boolean>);
}
