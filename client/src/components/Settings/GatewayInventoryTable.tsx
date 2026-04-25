import { Fragment, useMemo, useState } from 'react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { GatewayData } from '../../api/gateway.api';
import type { TunnelStatusEvent } from '../../store/gatewayStore';
import GatewayInventoryExpandedContent from './GatewayInventoryExpandedContent';
import {
  EmptyInventoryState,
  GatewayRowActionMenu,
  GatewayStatusCell,
  getGatewayInventoryExpandedContentId,
  SortableHeader,
} from './GatewayInventoryTableParts';
import {
  formatGatewayType,
  getGatewayEndpointValue,
  getGatewayHealthMeta,
  getGatewayInventorySearchText,
  getGatewayModeBadge,
  getGatewayTunnelMeta,
  type GatewayTestState,
} from './gatewaySectionUtils';
import { SettingsPanel } from './settings-ui';

interface GatewayInventoryTableProps {
  expandedGatewayIds: Set<string>;
  gateways: GatewayData[];
  loading: boolean;
  pushStates: Record<string, { loading: boolean; result?: { ok: boolean; error?: string } }>;
  sshKeyReady: boolean;
  testStates: Record<string, GatewayTestState>;
  tunnelStatuses: Record<string, TunnelStatusEvent>;
  onCreateGateway: () => void;
  onDeleteGateway: (gateway: GatewayData) => void;
  onEditGateway: (gateway: GatewayData) => void;
  onExpandedChange: (gatewayId: string, expanded: boolean) => void;
  onPushKey: (gateway: GatewayData) => void;
  onTestGateway: (gateway: GatewayData) => void;
}

function getColumnAriaSort(
  isSortable: boolean,
  sortState: false | 'asc' | 'desc',
): 'ascending' | 'descending' | 'none' | undefined {
  if (!isSortable) return undefined;
  if (sortState === 'asc') return 'ascending';
  if (sortState === 'desc') return 'descending';
  return 'none';
}

export default function GatewayInventoryTable({
  expandedGatewayIds,
  gateways,
  loading,
  pushStates,
  sshKeyReady,
  testStates,
  tunnelStatuses,
  onCreateGateway,
  onDeleteGateway,
  onEditGateway,
  onExpandedChange,
  onPushKey,
  onTestGateway,
}: GatewayInventoryTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'gateway', desc: false }]);
  const [globalFilter, setGlobalFilter] = useState('');

  const columns = useMemo<ColumnDef<GatewayData>[]>(
    () => [
      {
        id: 'expand',
        enableSorting: false,
        cell: ({ row }) => {
          const expanded = expandedGatewayIds.has(row.original.id);
          const expandedContentId = getGatewayInventoryExpandedContentId(row.original.id);

          return (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`${expanded ? 'Hide' : 'Show'} details for ${row.original.name}`}
              aria-expanded={expanded}
              aria-controls={expandedContentId}
              onClick={() => onExpandedChange(row.original.id, !expanded)}
            >
              {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          );
        },
      },
      {
        id: 'gateway',
        accessorFn: (gateway) => gateway.name,
        header: ({ column }) => <SortableHeader column={column} title="Gateway" />,
        cell: ({ row }) => {
          const gateway = row.original;
          const pushState = pushStates[gateway.id];

          return (
            <div className="flex min-w-[19rem] flex-col gap-2">
              <div className="font-medium text-foreground">{gateway.name}</div>
              <p className="text-xs leading-5 whitespace-normal text-muted-foreground">
                {gateway.description ?? 'No description provided.'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{formatGatewayType(gateway.type)}</Badge>
                <Badge variant="outline">{getGatewayModeBadge(gateway)}</Badge>
                {gateway.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                {gateway.publishPorts ? <Badge variant="secondary">Published</Badge> : null}
              </div>
              {pushState?.result?.error ? (
                <p className="text-xs leading-5 whitespace-normal text-destructive">
                  SSH key push failed: {pushState.result.error}
                </p>
              ) : pushState?.result?.ok ? (
                <p className="text-xs leading-5 whitespace-normal text-primary">
                  SSH key pushed successfully.
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'endpoint',
        accessorFn: (gateway) => getGatewayEndpointValue(gateway),
        header: ({ column }) => <SortableHeader column={column} title="Endpoint" />,
        cell: ({ row }) => {
          const gateway = row.original;
          const endpointValue = getGatewayEndpointValue(gateway);
          const endpointDescription = gateway.deploymentMode === 'MANAGED_GROUP'
            ? `${gateway.desiredReplicas} desired · ${gateway.runningInstances} running`
            : `${gateway.host}:${gateway.port}`;

          return (
            <div className="flex min-w-[16rem] flex-col gap-1">
              <div className="font-medium text-foreground">{endpointValue}</div>
              <p className="text-xs leading-5 whitespace-normal text-muted-foreground">{endpointDescription}</p>
            </div>
          );
        },
      },
      {
        id: 'health',
        accessorFn: (gateway) => getGatewayHealthMeta(gateway, testStates[gateway.id]).label,
        header: ({ column }) => <SortableHeader column={column} title="Health" />,
        cell: ({ row }) => {
          const health = getGatewayHealthMeta(row.original, testStates[row.original.id]);

          return (
            <GatewayStatusCell
              label={health.label}
              description={health.description}
              tone={health.tone}
            />
          );
        },
      },
      {
        id: 'tunnel',
        accessorFn: (gateway) => getGatewayTunnelMeta(gateway, tunnelStatuses[gateway.id]).label,
        header: ({ column }) => <SortableHeader column={column} title="Tunnel" />,
        cell: ({ row }) => {
          const tunnel = getGatewayTunnelMeta(row.original, tunnelStatuses[row.original.id]);

          return (
            <GatewayStatusCell
              label={tunnel.label}
              description={tunnel.description}
              tone={tunnel.tone}
            />
          );
        },
      },
      {
        id: 'actions',
        enableSorting: false,
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <GatewayRowActionMenu
              gateway={row.original}
              pushState={pushStates[row.original.id]}
              sshKeyReady={sshKeyReady}
              testState={testStates[row.original.id]}
              onDeleteGateway={onDeleteGateway}
              onEditGateway={onEditGateway}
              onPushKey={onPushKey}
              onTestGateway={onTestGateway}
            />
          </div>
        ),
      },
    ],
    [
      expandedGatewayIds,
      onDeleteGateway,
      onEditGateway,
      onExpandedChange,
      onPushKey,
      onTestGateway,
      pushStates,
      sshKeyReady,
      testStates,
      tunnelStatuses,
    ],
  );

  const table = useReactTable({
    data: gateways,
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
      if (!query) return true;
      return getGatewayInventorySearchText(row.original).includes(query);
    },
    getRowId: (row) => row.id,
  });

  const rows = table.getRowModel().rows;
  const tableColumnCount = table.getVisibleLeafColumns().length;
  const summaryLabel = globalFilter.trim()
    ? `${rows.length} of ${gateways.length} gateways shown`
    : `${gateways.length} gateway${gateways.length === 1 ? '' : 's'}`;

  return (
    <SettingsPanel
      title="Gateway Inventory"
      description="Review transport endpoints, reachability, tunnels, and managed group capacity in one admin table."
      heading={(
        <Button type="button" variant="outline" size="sm" onClick={onCreateGateway}>
          <Plus className="size-4" />
          New Gateway
        </Button>
      )}
      contentClassName="flex flex-col gap-4"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading gateways.
        </div>
      ) : gateways.length === 0 ? (
        <EmptyInventoryState onCreateGateway={onCreateGateway} />
      ) : (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Input
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              className="w-full md:max-w-sm"
              placeholder="Filter gateways by name, endpoint, host, or type"
              aria-label="Filter gateways"
            />
            <Badge variant="outline" className="w-fit">
              {summaryLabel}
            </Badge>
          </div>

          <div className="min-w-0 w-full max-w-full rounded-xl border border-border/70 bg-card/70">
            <Table
              aria-label="Gateway inventory"
              className="min-w-[72rem]"
              containerClassName="overflow-x-scroll overscroll-x-contain pb-2 [scrollbar-width:auto] [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80 [&::-webkit-scrollbar-track]:bg-transparent"
            >
              <TableHeader>
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
                          className={cn(
                            header.id === 'expand' ? 'w-10 pr-0' : null,
                            header.id === 'actions' ? 'text-right' : null,
                          )}
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
                      No gateways match this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const gateway = row.original;
                    const expanded = expandedGatewayIds.has(gateway.id);
                    const expandedContentId = getGatewayInventoryExpandedContentId(gateway.id);

                    return (
                      <Fragment key={row.id}>
                        <TableRow data-state={expanded ? 'selected' : undefined}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell
                              key={cell.id}
                              className={cn(
                                'align-top',
                                cell.column.id === 'expand' ? 'pr-0' : 'whitespace-normal',
                                cell.column.id === 'actions' ? 'text-right' : null,
                              )}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                        {expanded ? (
                          <TableRow className="bg-background/40 hover:bg-background/40">
                            <TableCell colSpan={tableColumnCount} className="p-0">
                              <div id={expandedContentId} role="region" aria-label={`${gateway.name} details`}>
                                <GatewayInventoryExpandedContent
                                  gateway={gateway}
                                  pushState={pushStates[gateway.id]}
                                  testState={testStates[gateway.id]}
                                  tunnelStatus={tunnelStatuses[gateway.id]}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </SettingsPanel>
  );
}
