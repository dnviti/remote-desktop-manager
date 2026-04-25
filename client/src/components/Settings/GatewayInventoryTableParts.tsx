import type { Column } from '@tanstack/react-table';
import {
  ArrowUpDown,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Server,
  ShieldEllipsis,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { GatewayData } from '../../api/gateway.api';
import {
  type GatewayTestState,
} from './gatewaySectionUtils';

export function getGatewayInventoryExpandedContentId(gatewayId: string) {
  return `gateway-inventory-details-${gatewayId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function EmptyInventoryState({ onCreateGateway }: { onCreateGateway: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Server className="size-10 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <div className="text-base font-medium text-foreground">No gateways yet</div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            Add a gateway to route connections through GUACD, Managed SSH, database proxies,
            or bastion hosts.
          </p>
        </div>
        <Button type="button" onClick={onCreateGateway}>
          <Plus className="size-4" />
          Add Gateway
        </Button>
      </CardContent>
    </Card>
  );
}

export function SortableHeader({
  column,
  title,
  className,
}: {
  column: Column<GatewayData, unknown>;
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
      <ArrowUpDown className="size-4 text-muted-foreground" />
    </Button>
  );
}

function getToneBadgeClassName(tone: 'neutral' | 'success' | 'warning' | 'destructive') {
  switch (tone) {
    case 'success':
      return 'border-primary/25 bg-primary/10 text-primary';
    case 'warning':
      return 'border-chart-5/25 bg-chart-5/10 text-foreground';
    case 'destructive':
      return 'border-destructive/25 bg-destructive/10 text-destructive';
    default:
      return 'border-border bg-background text-foreground';
  }
}

export function GatewayStatusCell({
  label,
  description,
  tone,
}: {
  label: string;
  description: string;
  tone: 'neutral' | 'success' | 'warning' | 'destructive';
}) {
  return (
    <div className="flex min-w-[12rem] flex-col gap-1">
      <Badge variant="outline" className={cn('w-fit', getToneBadgeClassName(tone))}>
        {label}
      </Badge>
      <p className="text-xs leading-5 whitespace-normal text-muted-foreground">{description}</p>
    </div>
  );
}

export function GatewayRowActionMenu({
  gateway,
  pushState,
  sshKeyReady,
  testState,
  onDeleteGateway,
  onEditGateway,
  onPushKey,
  onTestGateway,
}: {
  gateway: GatewayData;
  pushState?: { loading: boolean; result?: { ok: boolean; error?: string } };
  sshKeyReady: boolean;
  testState?: GatewayTestState;
  onDeleteGateway: (gateway: GatewayData) => void;
  onEditGateway: (gateway: GatewayData) => void;
  onPushKey: (gateway: GatewayData) => void;
  onTestGateway: (gateway: GatewayData) => void;
}) {
  const pushDisabled = !sshKeyReady || pushState?.loading;
  const testDisabled = Boolean(testState?.loading);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Open actions for ${gateway.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{gateway.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={testDisabled} onClick={() => onTestGateway(gateway)}>
            {testState?.loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {testState?.loading ? 'Testing…' : 'Test'}
          </DropdownMenuItem>
          {gateway.type === 'MANAGED_SSH' ? (
            <DropdownMenuItem disabled={pushDisabled} onClick={() => onPushKey(gateway)}>
              {pushState?.loading ? <Loader2 className="size-4 animate-spin" /> : <ShieldEllipsis className="size-4" />}
              {pushState?.loading ? 'Pushing key…' : 'Push Key'}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => onEditGateway(gateway)}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => onDeleteGateway(gateway)}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
