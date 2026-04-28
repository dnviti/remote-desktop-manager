import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Textarea } from '@/components/ui/textarea';
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
  onOpenChange: (open: boolean) => void;
  onChange: (ruleId: string, patch: Partial<EgressDraftRule>) => void;
}

export default function GatewayEgressPolicyRuleDialog({
  open,
  rule,
  ruleNumber,
  errors,
  onOpenChange,
  onChange,
}: GatewayEgressPolicyRuleDialogProps) {
  const hasErrors = errors && Object.keys(errors).length > 0;

  if (!rule) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-4xl lg:max-w-5xl">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div className="flex flex-col gap-2">
              <DialogTitle>Edit Allow Rule {ruleNumber}</DialogTitle>
              <DialogDescription>
                Configure protocols, destinations, and ports for this gateway allow rule.
              </DialogDescription>
            </div>
            <Badge variant={hasErrors ? 'destructive' : 'outline'}>
              {hasErrors ? 'Needs info' : 'Ready'}
            </Badge>
          </div>
        </DialogHeader>

        <div className="grid gap-4 xl:grid-cols-[minmax(260px,0.8fr)_minmax(520px,1.2fr)]">
          <div className="flex flex-col gap-3">
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
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
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

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
