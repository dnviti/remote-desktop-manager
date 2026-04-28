import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type EgressDraftRule,
  type EgressValidationErrors,
  GATEWAY_EGRESS_PROTOCOL_OPTIONS,
} from './gatewayEgressPolicyUtils';

interface GatewayEgressPolicyTableProps {
  rules: EgressDraftRule[];
  editingRuleId: string | null;
  validationErrors: EgressValidationErrors;
  onEditRule: (ruleId: string) => void;
  onRemoveRule: (ruleId: string) => void;
  onMoveRule: (ruleId: string, direction: -1 | 1) => void;
}

const PROTOCOL_LABELS = new Map(
  GATEWAY_EGRESS_PROTOCOL_OPTIONS.map((option) => [option.value, option.label]),
);

function SummaryBadges({
  values,
  emptyLabel,
  limit = 3,
}: {
  values: string[];
  emptyLabel: string;
  limit?: number;
}) {
  if (values.length === 0) {
    return <span className="text-xs text-muted-foreground">{emptyLabel}</span>;
  }

  const visibleValues = values.slice(0, limit);
  const hiddenCount = values.length - visibleValues.length;

  return (
    <div className="flex max-w-[260px] flex-wrap gap-1">
      {visibleValues.map((value) => (
        <Badge key={value} variant="outline" className="max-w-full truncate">
          {value}
        </Badge>
      ))}
      {hiddenCount > 0 && <Badge variant="secondary">+{hiddenCount}</Badge>}
    </div>
  );
}

function TargetSummary({ rule }: { rule: EgressDraftRule }) {
  const targets = [
    ...rule.hosts.map((value) => ({ label: 'Host', value })),
    ...rule.cidrs.map((value) => ({ label: 'CIDR', value })),
  ];

  if (targets.length === 0) {
    return <span className="text-xs text-muted-foreground">No targets</span>;
  }

  const visibleTargets = targets.slice(0, 3);
  const hiddenCount = targets.length - visibleTargets.length;

  return (
    <div className="flex max-w-[300px] flex-wrap gap-1">
      {visibleTargets.map((target) => (
        <Badge
          key={`${target.label}:${target.value}`}
          variant="outline"
          className="max-w-full gap-1 truncate"
        >
          <span className="text-muted-foreground">{target.label}</span>
          <span className="truncate">{target.value}</span>
        </Badge>
      ))}
      {hiddenCount > 0 && <Badge variant="secondary">+{hiddenCount}</Badge>}
    </div>
  );
}

export default function GatewayEgressPolicyTable({
  rules,
  editingRuleId,
  validationErrors,
  onEditRule,
  onRemoveRule,
  onMoveRule,
}: GatewayEgressPolicyTableProps) {
  return (
    <div className="rounded-md border">
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Rule</TableHead>
            <TableHead className="min-w-[180px]">Rule</TableHead>
            <TableHead className="min-w-[120px]">Action</TableHead>
            <TableHead className="min-w-[160px]">Scope</TableHead>
            <TableHead className="min-w-[150px]">Protocols</TableHead>
            <TableHead className="min-w-[220px]">Destinations</TableHead>
            <TableHead className="min-w-[140px]">Ports</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-28 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="h-20 text-center text-muted-foreground">
                No firewall rules configured.
              </TableCell>
            </TableRow>
          ) : (
            rules.map((rule, index) => {
              const ruleErrors = validationErrors[rule.id] ?? {};
              const errorCount = Object.keys(ruleErrors).length;
              const protocolLabels = rule.protocols.map(
                (protocol) => PROTOCOL_LABELS.get(protocol) ?? protocol,
              );

              return (
                <TableRow
                  key={rule.id}
                  data-state={editingRuleId === rule.id ? 'selected' : undefined}
                  className={cn('cursor-pointer', !rule.enabled && 'opacity-65')}
                  onClick={() => onEditRule(rule.id)}
                >
                  <TableCell className="font-medium">#{index + 1}</TableCell>
                  <TableCell className="max-w-[240px] whitespace-normal">
                    <div className="flex flex-col gap-1">
                      <span className="truncate">{rule.description.trim() || 'Untitled rule'}</span>
                      {!rule.description.trim() && (
                        <span className="text-xs text-muted-foreground">No description</span>
                      )}
                      {!rule.enabled && (
                        <Badge variant="secondary" className="w-fit">Disabled</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={rule.action === 'DISALLOW' ? 'destructive' : 'outline'}>
                      {rule.action === 'DISALLOW' ? 'Disallow' : 'Allow'}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <SummaryBadges
                      values={[
                        ...rule.userIds.map((value) => `User ${value.slice(0, 8)}`),
                        ...rule.teamIds.map((value) => `Team ${value.slice(0, 8)}`),
                      ]}
                      emptyLabel="Everyone"
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <SummaryBadges values={protocolLabels} emptyLabel="No protocols" />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <TargetSummary rule={rule} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <SummaryBadges values={rule.ports} emptyLabel="No ports" />
                  </TableCell>
                  <TableCell>
                    <Badge variant={errorCount > 0 ? 'destructive' : 'outline'}>
                      {!rule.enabled ? 'Draft' : errorCount > 0 ? 'Needs info' : 'Ready'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move rule ${index + 1} up`}
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveRule(rule.id, -1);
                        }}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move rule ${index + 1} down`}
                        disabled={index === rules.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMoveRule(rule.id, 1);
                        }}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit rule ${index + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditRule(rule.id);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove rule ${index + 1}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveRule(rule.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
