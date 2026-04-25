import { useMemo, useState } from 'react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { TenantUser } from '../../api/tenant.api';
import { ROLE_LABELS, type TenantRole } from '../../utils/roles';
import {
  MemberActionMenu,
  MemberIdentityCell,
  MemberStatusCell,
  RoleCell,
  SortableMemberHeader,
} from './tenantSectionMembersTableParts';
import {
  formatExpiry,
  getColumnAriaSort,
  getColumnClassName,
  getMemberName,
  getMemberSearchText,
  getMfaLabel,
} from './tenantSectionMembersTableUtils';

interface TenantMembersTableProps {
  currentUserId?: string;
  isAdmin: boolean;
  onChangeEmail: (user: TenantUser) => void;
  onChangePassword: (user: TenantUser) => void;
  onEditExpiry: (user: TenantUser) => void;
  onEditPermissions: (user: TenantUser) => void;
  onRemove: (user: TenantUser) => void;
  onRoleChange: (userId: string, role: TenantRole) => void;
  onToggleEnabled: (userId: string, enabled: boolean) => void;
  onViewUserProfile?: (userId: string) => void;
  togglingUserId?: string | null;
  users: TenantUser[];
}

export default function TenantMembersTable({
  currentUserId,
  isAdmin,
  onChangeEmail,
  onChangePassword,
  onEditExpiry,
  onEditPermissions,
  onRemove,
  onRoleChange,
  onToggleEnabled,
  onViewUserProfile,
  togglingUserId,
  users,
}: TenantMembersTableProps) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'member', desc: false }]);

  const columns = useMemo<ColumnDef<TenantUser>[]>(() => {
    const baseColumns: ColumnDef<TenantUser>[] = [
      {
        id: 'member',
        accessorFn: (user) => getMemberName(user),
        header: ({ column }) => <SortableMemberHeader column={column} title="Member" />,
        cell: ({ row }) => (
          <MemberIdentityCell user={row.original} onViewUserProfile={onViewUserProfile} />
        ),
      },
      {
        id: 'role',
        accessorFn: (user) => ROLE_LABELS[user.role as TenantRole] ?? user.role,
        header: ({ column }) => <SortableMemberHeader column={column} title="Role" />,
        cell: ({ row }) => {
          const isCurrentUser = row.original.id === currentUserId;

          return (
            <RoleCell
              user={row.original}
              canEditRole={isAdmin && !isCurrentUser}
              onRoleChange={onRoleChange}
            />
          );
        },
      },
      {
        id: 'status',
        accessorFn: (user) => (user.enabled === false ? 'disabled' : 'active'),
        header: ({ column }) => <SortableMemberHeader column={column} title="Status" />,
        cell: ({ row }) => (
          <MemberStatusCell
            user={row.original}
            isCurrentUser={row.original.id === currentUserId}
          />
        ),
      },
      {
        id: 'expiry',
        accessorFn: (user) => user.expiresAt ?? '',
        header: ({ column }) => <SortableMemberHeader column={column} title="Expiration" />,
        cell: ({ row }) => (
          <Badge
            variant={row.original.expired ? 'destructive' : row.original.expiresAt ? 'secondary' : 'outline'}
          >
            {formatExpiry(row.original)}
          </Badge>
        ),
      },
      {
        id: 'security',
        accessorFn: (user) => getMfaLabel(user),
        header: ({ column }) => <SortableMemberHeader column={column} title="MFA" />,
        cell: ({ row }) => {
          const hasMfa = row.original.totpEnabled || row.original.smsMfaEnabled;

          return (
            <Badge variant={hasMfa ? 'default' : 'outline'}>
              {getMfaLabel(row.original)}
            </Badge>
          );
        },
      },
    ];

    const adminColumns: ColumnDef<TenantUser>[] = isAdmin ? [
      {
        id: 'permissions',
        enableSorting: false,
        header: () => 'Permissions',
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onEditPermissions(row.original)}
          >
            <Settings2 data-icon="inline-start" />
            Permissions
          </Button>
        ),
      },
      {
        id: 'enabled',
        enableSorting: false,
        header: () => 'Enabled',
        cell: ({ row }) => {
          const isCurrentUser = row.original.id === currentUserId;
          const isEnabled = row.original.enabled !== false;

          return isCurrentUser ? (
            <Badge variant="secondary">Current user</Badge>
          ) : (
            <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
              <span>Enabled</span>
              <Switch
                checked={isEnabled}
                disabled={togglingUserId === row.original.id}
                aria-label={`Toggle ${getMemberName(row.original)}`}
                onCheckedChange={(checked) => onToggleEnabled(row.original.id, checked)}
              />
            </label>
          );
        },
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            {row.original.id === currentUserId ? null : (
              <MemberActionMenu
                user={row.original}
                onChangeEmail={onChangeEmail}
                onChangePassword={onChangePassword}
                onEditExpiry={onEditExpiry}
                onRemove={onRemove}
              />
            )}
          </div>
        ),
      },
    ] : [];

    return [...baseColumns, ...adminColumns];
  }, [
    currentUserId,
    isAdmin,
    onChangeEmail,
    onChangePassword,
    onEditExpiry,
    onEditPermissions,
    onRemove,
    onRoleChange,
    onToggleEnabled,
    onViewUserProfile,
    togglingUserId,
  ]);

  const table = useReactTable({
    data: users,
    columns,
    state: {
      globalFilter,
      sorting,
    },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue).trim().toLowerCase();
      return query ? getMemberSearchText(row.original).includes(query) : true;
    },
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;
  const tableColumnCount = table.getVisibleLeafColumns().length;
  const summaryLabel = globalFilter.trim()
    ? `${rows.length} of ${users.length} members shown`
    : `${users.length} member${users.length === 1 ? '' : 's'}`;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          className="w-full md:max-w-sm"
          placeholder="Filter members by name, email, role, or status"
          aria-label="Filter members"
        />
        <Badge variant="outline" className="w-fit">
          {summaryLabel}
        </Badge>
      </div>

      <div className="min-w-0 w-full max-w-full rounded-xl border border-border/70 bg-card/70">
        <Table
          aria-label="Organization members"
          className={cn(isAdmin ? 'min-w-[82rem]' : 'min-w-[58rem]')}
          containerClassName="max-h-[34rem] overflow-auto overscroll-contain [scrollbar-width:auto] [&::-webkit-scrollbar]:size-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          <TableHeader className="sticky top-0 bg-card">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const isSortable = header.column.getCanSort();
                  const sortState = header.column.getIsSorted();

                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      aria-sort={getColumnAriaSort(isSortable, sortState)}
                      className={getColumnClassName(header.column.id)}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={tableColumnCount} className="py-12 text-center text-muted-foreground">
                  No members match this filter.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn('align-top', getColumnClassName(cell.column.id))}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
