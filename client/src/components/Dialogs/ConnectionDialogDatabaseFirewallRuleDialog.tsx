import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ConnectionFirewallRule } from "../../api/connections.api";
import { FIREWALL_RULE_TEMPLATES } from "../Settings/dbFirewallPolicyConfig";
import {
  PolicyDialogShell,
  PolicyFormSection,
} from "../Settings/databasePolicyUi";
import { SettingsFieldCard, SettingsSwitchRow } from "../Settings/settings-ui";
import ConnectionDialogPolicyPresetSelect from "./ConnectionDialogPolicyPresetSelect";

interface ConnectionDialogDatabaseFirewallRuleDialogProps {
  open: boolean;
  editingRuleId: string | null;
  formData: ConnectionFirewallRule;
  patternError: string | null;
  onOpenChange: (open: boolean) => void;
  onApplyTemplate: (templateName: string) => void;
  onSave: () => void;
  onFieldChange: <K extends keyof ConnectionFirewallRule>(
    key: K,
    value: ConnectionFirewallRule[K],
  ) => void;
  onPatternChange: (value: string) => void;
}

export default function ConnectionDialogDatabaseFirewallRuleDialog({
  open,
  editingRuleId,
  formData,
  patternError,
  onOpenChange,
  onApplyTemplate,
  onSave,
  onFieldChange,
  onPatternChange,
}: ConnectionDialogDatabaseFirewallRuleDialogProps) {
  return (
    <PolicyDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={
        editingRuleId
          ? "Edit Connection Firewall Rule"
          : "Create Connection Firewall Rule"
      }
      description="Define a SQL pattern and response action for this connection only."
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={
              !formData.name?.trim() ||
              !formData.pattern?.trim() ||
              Boolean(patternError)
            }
          >
            {editingRuleId ? "Update Rule" : "Create Rule"}
          </Button>
        </>
      }
    >
      {!editingRuleId && (
        <ConnectionDialogPolicyPresetSelect
          title="Start from a template"
          description="Seed the rule with a proven pattern, then narrow the scope or adjust the priority for this connection."
          comboboxLabel="Connection firewall preset"
          templates={FIREWALL_RULE_TEMPLATES}
          onApply={onApplyTemplate}
        />
      )}

      <PolicyFormSection>
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard
            label="Rule name"
            description="Use a short name that reads well in audit events."
          >
            <Input
              aria-label="Connection firewall rule name"
              value={formData.name ?? ""}
              onChange={(event) => onFieldChange("name", event.target.value)}
            />
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Action"
            description="Choose whether matching queries are blocked, alerted, or only logged."
          >
            <Select
              value={formData.action ?? "BLOCK"}
              onValueChange={(value) =>
                onFieldChange(
                  "action",
                  value as ConnectionFirewallRule["action"],
                )
              }
            >
              <SelectTrigger aria-label="Connection firewall action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="BLOCK">Block execution</SelectItem>
                  <SelectItem value="ALERT">Allow and alert</SelectItem>
                  <SelectItem value="LOG">Allow and log</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsFieldCard>
        </div>

        <SettingsFieldCard
          label="Regex pattern"
          description="Patterns are evaluated server-side on SQL text before execution."
        >
          <Input
            aria-label="Connection firewall pattern"
            value={formData.pattern ?? ""}
            onChange={(event) => onPatternChange(event.target.value)}
            className="font-mono text-xs"
          />
          <p
            className={`text-xs ${patternError ? "text-destructive" : "text-muted-foreground"}`}
          >
            {patternError ??
              "Basic regex safety checks run locally before the backend validates the final expression."}
          </p>
        </SettingsFieldCard>

        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard
            label="Scope"
            description="Leave empty to apply the rule across every database or table reached through this connection."
          >
            <Input
              aria-label="Connection firewall scope"
              value={formData.scope ?? ""}
              placeholder="database or table name"
              onChange={(event) => onFieldChange("scope", event.target.value)}
            />
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Priority"
            description="Higher priority rules are evaluated before lower-priority rules."
          >
            <Input
              type="number"
              min={0}
              aria-label="Connection firewall priority"
              value={formData.priority ?? 0}
              onChange={(event) =>
                onFieldChange(
                  "priority",
                  Number.parseInt(event.target.value, 10) || 0,
                )
              }
            />
          </SettingsFieldCard>
        </div>

        <SettingsFieldCard
          label="Description"
          description="Optional context for why this connection needs this rule."
        >
          <Textarea
            aria-label="Connection firewall description"
            rows={3}
            value={formData.description ?? ""}
            onChange={(event) =>
              onFieldChange("description", event.target.value)
            }
          />
        </SettingsFieldCard>

        <SettingsSwitchRow
          title="Rule enabled"
          description="Disabled rules stay attached to the connection but are ignored by the DB proxy."
          checked={formData.enabled !== false}
          onCheckedChange={(checked) => onFieldChange("enabled", checked)}
        />
      </PolicyFormSection>
    </PolicyDialogShell>
  );
}
