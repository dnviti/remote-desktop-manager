import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Textarea } from '@/components/ui/textarea';
import UserPicker from '../UserPicker';
import type { TeamData } from '../../api/team.api';
import type { GatewayEgressProtocol } from '../../api/gateway.api';
import {
  type EgressDraftRule,
  type EgressRuleErrors,
  GATEWAY_EGRESS_PROTOCOL_OPTIONS,
  normalizeCidrOrIpEntry,
  normalizeHostEntry,
  normalizePortEntry,
  validateCidrOrIpEntry,
  validateHostEntry,
  validatePortEntry,
} from './gatewayEgressPolicyUtils';
import GatewayEgressEntryListEditor from './GatewayEgressEntryListEditor';

interface GatewayEgressPolicyRuleDialogProps {
  open: boolean;
  rule: EgressDraftRule | null;
  ruleNumber: number;
  errors?: EgressRuleErrors;
  teams: TeamData[];
  onOpenChange: (open: boolean) => void;
  onChange: (ruleId: string, patch: Partial<EgressDraftRule>) => void;
}

export default function GatewayEgressPolicyRuleDialog({
  open,
  rule,
  ruleNumber,
  errors,
  teams,
  onOpenChange,
  onChange,
}: GatewayEgressPolicyRuleDialogProps) {
  const hasErrors = errors && Object.keys(errors).length > 0;

  if (!rule) {
    return null;
  }

  const addTeam = (teamId: string) => {
    if (!teamId || rule.teamIds.includes(teamId)) return;
    onChange(rule.id, { teamIds: [...rule.teamIds, teamId] });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-[760px]">
        <SheetHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="flex flex-col gap-2">
              <SheetTitle>Edit Egress Rule {ruleNumber}</SheetTitle>
              <SheetDescription>
                Configure action, scope, protocols, destinations, and ports for this ordered firewall rule.
              </SheetDescription>
            </div>
            <Badge variant={hasErrors ? 'destructive' : 'outline'}>
              {!rule.enabled ? 'Draft' : hasErrors ? 'Needs info' : 'Ready'}
            </Badge>
          </div>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div>
              <Label className="text-xs">Enabled</Label>
              <p className="text-xs text-muted-foreground">Disabled rules are saved as drafts and ignored.</p>
            </div>
            <Switch
              checked={rule.enabled}
              aria-label={`Enable rule ${ruleNumber}`}
              onCheckedChange={(enabled) => onChange(rule.id, { enabled })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Action</Label>
            <ToggleGroup
              type="single"
              value={rule.action}
              className="justify-start"
              onValueChange={(value) => {
                if (value === 'ALLOW' || value === 'DISALLOW') onChange(rule.id, { action: value });
              }}
            >
              <ToggleGroupItem value="ALLOW" size="sm" variant="outline">Allow</ToggleGroupItem>
              <ToggleGroupItem value="DISALLOW" size="sm" variant="outline">Disallow</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={rule.description}
              rows={3}
              maxLength={160}
              className="text-xs"
              placeholder="Optional policy note"
              onChange={(event) => onChange(rule.id, { description: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Protocols</Label>
            <ToggleGroup
              type="multiple"
              value={rule.protocols}
              className="flex flex-wrap justify-start"
              onValueChange={(values) =>
                onChange(rule.id, { protocols: values as GatewayEgressProtocol[] })
              }
            >
              {GATEWAY_EGRESS_PROTOCOL_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  size="sm"
                  variant="outline"
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {errors?.protocols && <p className="text-xs text-destructive">{errors.protocols}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs">Scope</Label>
            <p className="text-xs text-muted-foreground">
              {rule.userIds.length === 0 && rule.teamIds.length === 0
                ? 'Everyone'
                : `${rule.userIds.length} user${rule.userIds.length === 1 ? '' : 's'}, ${rule.teamIds.length} team${rule.teamIds.length === 1 ? '' : 's'}`}
            </p>
            <UserPicker
              scope="tenant"
              clearAfterSelect
              placeholder="Add user scope..."
              onSelect={(user) => {
                if (user && !rule.userIds.includes(user.id)) {
                  onChange(rule.id, { userIds: [...rule.userIds, user.id] });
                }
              }}
            />
            <Select onValueChange={addTeam}>
              <SelectTrigger aria-label="Add team scope">
                <SelectValue placeholder="Add team scope..." />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id} disabled={rule.teamIds.includes(team.id)}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {(rule.userIds.length > 0 || rule.teamIds.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {rule.userIds.map((userId) => (
                  <Button
                    key={userId}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(rule.id, { userIds: rule.userIds.filter((id) => id !== userId) })}
                  >
                    User {userId.slice(0, 8)}
                  </Button>
                ))}
                {rule.teamIds.map((teamId) => {
                  const team = teams.find((item) => item.id === teamId);
                  return (
                    <Button
                      key={teamId}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onChange(rule.id, { teamIds: rule.teamIds.filter((id) => id !== teamId) })}
                    >
                      {team?.name ?? `Team ${teamId.slice(0, 8)}`}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <GatewayEgressEntryListEditor
              label="Hosts"
              inputLabel={`Host or Pattern for Rule ${ruleNumber}`}
              placeholder="app.example.com or *.example.com"
              entries={rule.hosts}
              emptyState="Exact hosts, IP hosts, and leading wildcard domains are allowed."
              addLabel={`Add host or pattern to rule ${ruleNumber}`}
              normalizeEntry={normalizeHostEntry}
              validateEntry={validateHostEntry}
              onChange={(hosts) => onChange(rule.id, { hosts })}
            />

            <GatewayEgressEntryListEditor
              label="Subnets / IPs"
              inputLabel={`CIDR or IP for Rule ${ruleNumber}`}
              placeholder="10.10.0.0/16 or 203.0.113.10"
              entries={rule.cidrs}
              emptyState="Bare IPs are saved as /32 or /128 exact-match prefixes."
              addLabel={`Add CIDR or IP to rule ${ruleNumber}`}
              normalizeEntry={normalizeCidrOrIpEntry}
              validateEntry={validateCidrOrIpEntry}
              onChange={(cidrs) => onChange(rule.id, { cidrs })}
            />

            <GatewayEgressEntryListEditor
              label="Ports"
              inputLabel={`Port for Rule ${ruleNumber}`}
              placeholder="22, 3389, 5432"
              entries={rule.ports}
              emptyState="Add every destination port this rule may reach."
              addLabel={`Add port to rule ${ruleNumber}`}
              normalizeEntry={normalizePortEntry}
              validateEntry={validatePortEntry}
              onChange={(ports) => onChange(rule.id, { ports })}
            />
          </div>
        </div>

        {(errors?.targets || errors?.ports) && (
          <div className="flex flex-col gap-1">
            {errors?.targets && <p className="text-xs text-destructive">{errors.targets}</p>}
            {errors?.ports && <p className="text-xs text-destructive">{errors.ports}</p>}
          </div>
        )}

        <SheetFooter>
          <SheetClose asChild>
            <Button type="button" variant="outline">
              Done
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
