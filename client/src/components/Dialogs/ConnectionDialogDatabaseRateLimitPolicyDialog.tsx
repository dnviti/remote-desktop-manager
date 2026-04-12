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
import type { ConnectionRateLimitPolicy } from "../../api/connections.api";
import type { DbQueryType } from "../../api/dbAudit.api";
import {
  ALL_QUERY_TYPES,
  RATE_LIMIT_EXEMPT_ROLES,
  RATE_LIMIT_POLICY_TEMPLATES,
  RATE_LIMIT_QUERY_TYPE_OPTIONS,
  RATE_LIMIT_WINDOW_OPTIONS,
} from "../Settings/dbRateLimitPolicyConfig";
import {
  PolicyDialogShell,
  PolicyFormSection,
  PolicyRoleChecklist,
} from "../Settings/databasePolicyUi";
import { SettingsFieldCard, SettingsSwitchRow } from "../Settings/settings-ui";
import ConnectionDialogPolicyPresetSelect from "./ConnectionDialogPolicyPresetSelect";

interface ConnectionDialogDatabaseRateLimitPolicyDialogProps {
  open: boolean;
  editingPolicyId: string | null;
  formData: ConnectionRateLimitPolicy;
  onOpenChange: (open: boolean) => void;
  onApplyTemplate: (templateName: string) => void;
  onSave: () => void;
  onFieldChange: <K extends keyof ConnectionRateLimitPolicy>(
    key: K,
    value: ConnectionRateLimitPolicy[K],
  ) => void;
}

export default function ConnectionDialogDatabaseRateLimitPolicyDialog({
  open,
  editingPolicyId,
  formData,
  onOpenChange,
  onApplyTemplate,
  onSave,
  onFieldChange,
}: ConnectionDialogDatabaseRateLimitPolicyDialogProps) {
  return (
    <PolicyDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={
        editingPolicyId
          ? "Edit Connection Rate Limit Policy"
          : "Create Connection Rate Limit Policy"
      }
      description="Set the query type, rolling window, and response when this connection crosses the limit."
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
            disabled={!formData.name?.trim()}
          >
            {editingPolicyId ? "Update Policy" : "Create Policy"}
          </Button>
        </>
      }
    >
      {!editingPolicyId && (
        <ConnectionDialogPolicyPresetSelect
          title="Start from a template"
          description="Choose a baseline limit and then tune the scope, burst allowance, or exemptions for this connection."
          comboboxLabel="Connection rate limit preset"
          templates={RATE_LIMIT_POLICY_TEMPLATES}
          onApply={onApplyTemplate}
        />
      )}

      <PolicyFormSection>
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard
            label="Policy name"
            description="Keep the name readable in alerts and audit logs."
          >
            <Input
              aria-label="Connection rate limit policy name"
              value={formData.name ?? ""}
              onChange={(event) => onFieldChange("name", event.target.value)}
            />
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Response"
            description="Reject overages immediately or log them for review."
          >
            <Select
              value={formData.action ?? "REJECT"}
              onValueChange={(value) =>
                onFieldChange(
                  "action",
                  value as ConnectionRateLimitPolicy["action"],
                )
              }
            >
              <SelectTrigger aria-label="Connection rate limit action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="REJECT">Reject excess queries</SelectItem>
                  <SelectItem value="LOG_ONLY">Log excess queries</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsFieldCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsFieldCard
            label="Query type"
            description="Limit a specific SQL class or all statements together."
          >
            <Select
              value={formData.queryType ?? ALL_QUERY_TYPES}
              onValueChange={(value) =>
                onFieldChange(
                  "queryType",
                  value === ALL_QUERY_TYPES ? null : (value as DbQueryType),
                )
              }
            >
              <SelectTrigger aria-label="Connection rate limit query type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {RATE_LIMIT_QUERY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Time window"
            description="The rolling window used to count matching queries."
          >
            <Select
              value={String(formData.windowMs ?? 60000)}
              onValueChange={(value) =>
                onFieldChange("windowMs", Number(value))
              }
            >
              <SelectTrigger aria-label="Connection rate limit time window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {RATE_LIMIT_WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsFieldCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <SettingsFieldCard
            label="Max queries"
            description="How many matching queries fit inside the window."
          >
            <Input
              type="number"
              min={1}
              aria-label="Connection rate limit max queries"
              value={formData.maxQueries ?? 100}
              onChange={(event) =>
                onFieldChange(
                  "maxQueries",
                  Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                )
              }
            />
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Burst allowance"
            description="Short-term tokens available above the steady limit."
          >
            <Input
              type="number"
              min={1}
              aria-label="Connection rate limit burst max"
              value={formData.burstMax ?? 10}
              onChange={(event) =>
                onFieldChange(
                  "burstMax",
                  Math.max(1, Number.parseInt(event.target.value, 10) || 1),
                )
              }
            />
          </SettingsFieldCard>

          <SettingsFieldCard
            label="Priority"
            description="Higher priority policies are evaluated before lower-priority policies."
          >
            <Input
              type="number"
              min={0}
              aria-label="Connection rate limit priority"
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

        <PolicyRoleChecklist
          label="Exempt roles"
          description="Selected roles bypass the rate limit entirely for this connection."
          options={RATE_LIMIT_EXEMPT_ROLES}
          selected={formData.exemptRoles ?? []}
          onChange={(selected) => onFieldChange("exemptRoles", selected)}
        />

        <SettingsFieldCard
          label="Scope"
          description="Leave empty to apply the policy across every database and table reached through this connection."
        >
          <Input
            aria-label="Connection rate limit scope"
            value={formData.scope ?? ""}
            placeholder="database or table name"
            onChange={(event) => onFieldChange("scope", event.target.value)}
          />
        </SettingsFieldCard>

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
