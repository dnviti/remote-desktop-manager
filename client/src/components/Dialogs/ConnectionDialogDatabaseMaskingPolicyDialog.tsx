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
import type { ConnectionMaskingPolicy } from "../../api/connections.api";
import {
  MASKING_EXEMPT_ROLES,
  MASKING_POLICY_TEMPLATES,
  MASKING_STRATEGY_OPTIONS,
} from "../Settings/dbMaskingPolicyConfig";
import {
  PolicyDialogShell,
  PolicyFormSection,
  PolicyRoleChecklist,
} from "../Settings/databasePolicyUi";
import { SettingsFieldCard, SettingsSwitchRow } from "../Settings/settings-ui";
import ConnectionDialogPolicyPresetSelect from "./ConnectionDialogPolicyPresetSelect";

interface ConnectionDialogDatabaseMaskingPolicyDialogProps {
  open: boolean;
  editingPolicyId: string | null;
  formData: ConnectionMaskingPolicy;
  patternError: string | null;
  selectedStrategyDescription?: string;
  onOpenChange: (open: boolean) => void;
  onApplyTemplate: (templateName: string) => void;
  onSave: () => void;
  onFieldChange: <K extends keyof ConnectionMaskingPolicy>(
    key: K,
    value: ConnectionMaskingPolicy[K],
  ) => void;
  onPatternChange: (value: string) => void;
}

export default function ConnectionDialogDatabaseMaskingPolicyDialog({
  open,
  editingPolicyId,
  formData,
  patternError,
  selectedStrategyDescription,
  onOpenChange,
  onApplyTemplate,
  onSave,
  onFieldChange,
  onPatternChange,
}: ConnectionDialogDatabaseMaskingPolicyDialogProps) {
  return (
    <PolicyDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={
        editingPolicyId
          ? "Edit Connection Masking Policy"
          : "Create Connection Masking Policy"
      }
      description="Choose how matching columns should be transformed and which roles can bypass the mask on this connection."
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
              !formData.columnPattern?.trim() ||
              Boolean(patternError)
            }
          >
            {editingPolicyId ? "Update Policy" : "Create Policy"}
          </Button>
        </>
      }
    >
      {!editingPolicyId && (
        <ConnectionDialogPolicyPresetSelect
          title="Start from a template"
          description="Use a proven pattern for sensitive columns, then adapt the scope or exemptions for this connection."
          comboboxLabel="Connection masking preset"
          templates={MASKING_POLICY_TEMPLATES}
          onApply={onApplyTemplate}
        />
      )}

      <PolicyFormSection>
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard
            label="Policy name"
            description="Use a readable name that makes incident review fast."
          >
            <Input
              aria-label="Connection masking policy name"
              value={formData.name ?? ""}
              onChange={(event) => onFieldChange("name", event.target.value)}
            />
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Masking strategy"
            description="Choose how matched column values should be transformed."
          >
            <Select
              value={formData.strategy ?? "REDACT"}
              onValueChange={(value) =>
                onFieldChange(
                  "strategy",
                  value as ConnectionMaskingPolicy["strategy"],
                )
              }
            >
              <SelectTrigger aria-label="Connection masking strategy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MASKING_STRATEGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selectedStrategyDescription}
            </p>
          </SettingsFieldCard>
        </div>

        <SettingsFieldCard
          label="Column pattern"
          description="Use a regular expression that matches sensitive column names such as email, password, or credit_card."
        >
          <Input
            aria-label="Connection masking pattern"
            value={formData.columnPattern ?? ""}
            onChange={(event) => onPatternChange(event.target.value)}
            className="font-mono text-xs"
          />
          <p
            className={`text-xs ${patternError ? "text-destructive" : "text-muted-foreground"}`}
          >
            {patternError ??
              "The pattern is checked locally before save and validated again by the backend."}
          </p>
        </SettingsFieldCard>

        <PolicyRoleChecklist
          label="Exempt roles"
          description="Selected roles receive raw values and bypass the mask entirely."
          options={MASKING_EXEMPT_ROLES}
          selected={formData.exemptRoles ?? []}
          onChange={(selected) => onFieldChange("exemptRoles", selected)}
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard
            label="Scope"
            description="Leave empty to apply the policy across every database and table reached through this connection."
          >
            <Input
              aria-label="Connection masking scope"
              value={formData.scope ?? ""}
              placeholder="database or table name"
              onChange={(event) => onFieldChange("scope", event.target.value)}
            />
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Description"
            description="Optional context for why this connection needs its own masking policy."
          >
            <Textarea
              aria-label="Connection masking description"
              rows={3}
              value={formData.description ?? ""}
              onChange={(event) =>
                onFieldChange("description", event.target.value)
              }
            />
          </SettingsFieldCard>
        </div>

        <SettingsSwitchRow
          title="Policy enabled"
          description="Disabled policies stay attached to the connection but are ignored by the DB proxy."
          checked={formData.enabled !== false}
          onCheckedChange={(checked) => onFieldChange("enabled", checked)}
        />
      </PolicyFormSection>
    </PolicyDialogShell>
  );
}
