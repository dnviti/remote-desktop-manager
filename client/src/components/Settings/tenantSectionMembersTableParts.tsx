import type { Column } from '@tanstack/react-table';
import {
  ArrowUpDown,
  MoreHorizontal,
  Settings2,
  Shield,
  UserMinus,
  UserRoundCog,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { TenantUser } from '../../api/tenant.api';
import { ALL_ROLES, ROLE_LABELS, type TenantRole } from '../../utils/roles';
import { formatDate, getMemberName } from './tenantSectionMembersTableUtils';

function getInitials(user: TenantUser) {
  return getMemberName(user)
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function SortableMemberHeader({
  column,
  title,
  className,
}: {
  column: Column<TenantUser, unknown>;
  title: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('h-auto px-0 font-medium text-foreground hover:bg-transparent', className)}
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
    >
      {title}
      <ArrowUpDown data-icon="inline-end" />
    </Button>
  );
}

export function MemberActionMenu({
  onChangeEmail,
  onChangePassword,
  onEditExpiry,
  onRemove,
  user,
}: {
  onChangeEmail: (user: TenantUser) => void;
  onChangePassword: (user: TenantUser) => void;
  onEditExpiry: (user: TenantUser) => void;
  onRemove: (user: TenantUser) => void;
  user: TenantUser;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Open actions for ${getMemberName(user)}`}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{getMemberName(user)}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => onChangeEmail(user)}>
            <UserRoundCog className="size-4" />
            Change Email
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onChangePassword(user)}>
            <Shield className="size-4" />
            Change Password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEditExpiry(user)}>
            <Settings2 className="size-4" />
            {user.expiresAt ? 'Change Expiration' : 'Set Expiration'}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => onRemove(user)}
          >
            <UserMinus className="size-4" />
            Remove Member
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function MemberIdentityCell({
  onViewUserProfile,
  user,
}: {
  onViewUserProfile?: (userId: string) => void;
  user: TenantUser;
}) {
  const name = getMemberName(user);

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-10">
        <AvatarImage src={user.avatarData || undefined} alt={name} />
        <AvatarFallback>{getInitials(user)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        {onViewUserProfile ? (
          <Button
            type="button"
            variant="link"
            className="h-auto min-w-0 max-w-full justify-start p-0 text-left text-sm font-semibold text-foreground"
            onClick={() => onViewUserProfile(user.id)}
          >
            <span className="truncate">{name}</span>
          </Button>
        ) : (
          <div className="truncate text-sm font-semibold text-foreground">{name}</div>
        )}
        <div className="truncate text-sm text-muted-foreground">{user.email}</div>
        <div className="text-xs text-muted-foreground">Joined {formatDate(user.createdAt)}</div>
      </div>
    </div>
  );
}

export function MemberStatusCell({
  isCurrentUser,
  user,
}: {
  isCurrentUser: boolean;
  user: TenantUser;
}) {
  const isEnabled = user.enabled !== false;

  return (
    <div className="flex flex-wrap gap-1.5">
      {isCurrentUser ? <Badge variant="secondary">You</Badge> : null}
      {user.pending ? <Badge variant="secondary">Pending Invite</Badge> : null}
      {user.expired ? <Badge variant="destructive">Expired</Badge> : null}
      <Badge variant={isEnabled ? 'default' : 'destructive'}>
        {isEnabled ? 'Active' : 'Disabled'}
      </Badge>
    </div>
  );
}

export function RoleCell({
  canEditRole,
  onRoleChange,
  user,
}: {
  canEditRole: boolean;
  onRoleChange: (userId: string, role: TenantRole) => void;
  user: TenantUser;
}) {
  if (!canEditRole) {
    return (
      <Badge variant={user.role === 'OWNER' || user.role === 'ADMIN' ? 'default' : 'outline'}>
        {ROLE_LABELS[user.role as TenantRole] ?? user.role}
      </Badge>
    );
  }

  return (
    <Select
      value={user.role}
      onValueChange={(value) => onRoleChange(user.id, value as TenantRole)}
    >
      <SelectTrigger aria-label={`Role for ${getMemberName(user)}`} className="w-[11rem]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {ALL_ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {ROLE_LABELS[role]}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
