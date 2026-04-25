import { Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TenantUser } from '../../api/tenant.api';
import type { TenantRole } from '../../utils/roles';
import { SettingsButtonRow, SettingsLoadingState, SettingsPanel } from './settings-ui';
import TenantMembersTable from './tenantSectionMembersTable';

interface TenantMembersPanelProps {
  currentUserId?: string;
  isAdmin: boolean;
  loading: boolean;
  onChangeEmail: (user: TenantUser) => void;
  onChangePassword: (user: TenantUser) => void;
  onCreateUser: () => void;
  onEditExpiry: (user: TenantUser) => void;
  onEditPermissions: (user: TenantUser) => void;
  onInvite: () => void;
  onRemove: (user: TenantUser) => void;
  onRoleChange: (userId: string, role: TenantRole) => void;
  onToggleEnabled: (userId: string, enabled: boolean) => void;
  onViewUserProfile?: (userId: string) => void;
  togglingUserId?: string | null;
  users: TenantUser[];
}

export default function TenantMembersPanel({
  currentUserId,
  isAdmin,
  loading,
  onChangeEmail,
  onChangePassword,
  onCreateUser,
  onEditExpiry,
  onEditPermissions,
  onInvite,
  onRemove,
  onRoleChange,
  onToggleEnabled,
  onViewUserProfile,
  togglingUserId,
  users,
}: TenantMembersPanelProps) {
  return (
    <SettingsPanel
      title="Members"
      description="Keep people, roles, and membership lifecycle controls in one place."
      heading={
        isAdmin ? (
          <SettingsButtonRow>
            <Button type="button" variant="outline" size="sm" onClick={onInvite}>
              <Send data-icon="inline-start" />
              Invite
            </Button>
            <Button type="button" size="sm" onClick={onCreateUser}>
              <Plus data-icon="inline-start" />
              Create User
            </Button>
          </SettingsButtonRow>
        ) : null
      }
      contentClassName="flex flex-col gap-4"
    >
      {loading ? (
        <SettingsLoadingState message="Loading members..." />
      ) : users.length === 0 ? (
        <Card className="border-dashed border-border/70 bg-muted/10 text-center">
          <CardHeader className="items-center px-6 py-8">
            <CardTitle className="text-lg">No members yet</CardTitle>
            <CardDescription className="max-w-2xl leading-6">
              Invite collaborators once the organization structure and tenant-wide policy are in place.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <TenantMembersTable
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onChangeEmail={onChangeEmail}
          onChangePassword={onChangePassword}
          onEditExpiry={onEditExpiry}
          onEditPermissions={onEditPermissions}
          onRemove={onRemove}
          onRoleChange={onRoleChange}
          onToggleEnabled={onToggleEnabled}
          onViewUserProfile={onViewUserProfile}
          togglingUserId={togglingUserId}
          users={users}
        />
      )}
    </SettingsPanel>
  );
}
