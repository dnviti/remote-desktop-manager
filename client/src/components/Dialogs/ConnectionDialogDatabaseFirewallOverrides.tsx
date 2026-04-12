import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Plus, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConnectionFirewallRule,
  DbSettings,
} from "../../api/connections.api";
import { validateDbFirewallPattern } from "../../utils/dbFirewallPattern";
import {
  EMPTY_FIREWALL_RULE_FORM,
  FIREWALL_ACTION_VARIANTS,
  FIREWALL_RULE_TEMPLATES,
} from "../Settings/dbFirewallPolicyConfig";
import { PolicyMetadataBadge } from "../Settings/databasePolicyUi";
import ConnectionDialogDatabasePolicyControls from "./ConnectionDialogDatabasePolicyControls";
import ConnectionDialogDatabaseFirewallRuleDialog from "./ConnectionDialogDatabaseFirewallRuleDialog";
import ConnectionDialogPolicyTable from "./ConnectionDialogPolicyTable";
import {
  CONNECTION_DB_POLICY_MODE_OPTIONS,
  createConnectionPolicyId,
  trimOptionalText,
} from "./connectionDbPolicyHelpers";

interface ConnectionDialogDatabaseFirewallOverridesProps {
  dbSettings: Partial<DbSettings>;
  onChange: Dispatch<SetStateAction<Partial<DbSettings>>>;
}

function emptyRuleForm(): ConnectionFirewallRule {
  return { ...EMPTY_FIREWALL_RULE_FORM };
}

export default function ConnectionDialogDatabaseFirewallOverrides({
  dbSettings,
  onChange,
}: ConnectionDialogDatabaseFirewallOverridesProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const [formData, setFormData] =
    useState<ConnectionFirewallRule>(emptyRuleForm());

  const rules = dbSettings.firewallRules ?? [];
  const mode = dbSettings.firewallPolicyMode ?? "inherit";
  const modeOption = useMemo(
    () =>
      CONNECTION_DB_POLICY_MODE_OPTIONS.find((option) => option.value === mode),
    [mode],
  );

  const resetForm = () => {
    setFormData(emptyRuleForm());
    setPatternError(null);
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingRuleId(null);
      resetForm();
    }
  };

  const updateField = <K extends keyof ConnectionFirewallRule>(
    key: K,
    value: ConnectionFirewallRule[K],
  ) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const openCreate = () => {
    setEditingRuleId(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (rule: ConnectionFirewallRule) => {
    setEditingRuleId(rule.id ?? null);
    setFormData({
      ...rule,
      scope: rule.scope ?? "",
      description: rule.description ?? "",
      enabled: rule.enabled ?? true,
      priority: rule.priority ?? 0,
    });
    setPatternError(null);
    setDialogOpen(true);
  };

  const applyTemplate = (templateName: string) => {
    const template = FIREWALL_RULE_TEMPLATES.find(
      (entry) => entry.name === templateName,
    );
    if (!template) {
      return;
    }
    setFormData((current) => ({
      ...current,
      name: template.name,
      pattern: template.pattern,
      action: template.action,
      description: template.description,
    }));
    setPatternError(validateDbFirewallPattern(template.pattern));
  };

  const handleSave = () => {
    const regexError = validateDbFirewallPattern(formData.pattern ?? "");
    if (regexError) {
      setPatternError(regexError);
      return;
    }

    const nextRule: ConnectionFirewallRule = {
      ...formData,
      id: formData.id ?? createConnectionPolicyId("firewall"),
      name: formData.name.trim(),
      pattern: formData.pattern.trim(),
      action: formData.action,
      scope: trimOptionalText(formData.scope),
      description: trimOptionalText(formData.description),
      enabled: formData.enabled !== false,
      priority: Number.isFinite(formData.priority)
        ? Number(formData.priority)
        : 0,
    };

    onChange((prev) => {
      const prevRules = prev.firewallRules ?? [];
      const nextRules = editingRuleId
        ? prevRules.map((rule) => (rule.id === editingRuleId ? nextRule : rule))
        : [...prevRules, nextRule];
      return { ...prev, firewallRules: nextRules };
    });
    closeDialog(false);
  };

  const handleDelete = (ruleId?: string) => {
    if (!ruleId) {
      return;
    }
    onChange((prev) => ({
      ...prev,
      firewallRules: (prev.firewallRules ?? []).filter(
        (rule) => rule.id !== ruleId,
      ),
    }));
  };

  return (
    <>
      <section className="flex flex-col gap-4 border-t border-border/60 pt-6 first:border-t-0 first:pt-0">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-primary" />
              <h5 className="text-sm font-semibold">DB Firewall</h5>
            </div>
            <p className="text-xs text-muted-foreground">
              Block, alert, or log SQL patterns for this specific connection.
              Built-in protections still apply while the firewall is enabled.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreate}
          >
            <Plus />
            Add Rule
          </Button>
        </div>

        <ConnectionDialogDatabasePolicyControls
          enabledTitle="Enable firewall enforcement"
          enabledDescription="Disable this only when the connection must bypass both tenant-wide and connection-specific custom firewall rules."
          enabled={dbSettings.firewallEnabled !== false}
          onEnabledChange={(checked) =>
            onChange((prev) => ({ ...prev, firewallEnabled: checked }))
          }
          mode={mode}
          modeDescription={modeOption?.description}
          selectId="db-firewall-mode"
          onModeChange={(value) =>
            onChange((prev) => ({
              ...prev,
              firewallPolicyMode: value,
            }))
          }
        />

        <ConnectionDialogPolicyTable
          ariaLabel="Connection firewall rules"
          items={rules}
          columns={[
            {
              id: "name",
              header: "Rule",
              className: "align-top whitespace-normal",
              cell: (rule) => (
                <div className="flex min-w-[14rem] flex-col gap-1">
                  <span className="font-medium text-foreground">
                    {rule.name}
                  </span>
                  {rule.description ? (
                    <span className="text-xs text-muted-foreground">
                      {rule.description}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    Priority {rule.priority ?? 0}
                  </span>
                </div>
              ),
            },
            {
              id: "pattern",
              header: "Pattern",
              className: "align-top whitespace-normal",
              cell: (rule) => (
                <code className="block max-w-[24rem] break-all rounded-md bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">
                  {rule.pattern}
                </code>
              ),
            },
            {
              id: "action",
              header: "Action",
              cell: (rule) => (
                <PolicyMetadataBadge
                  variant={FIREWALL_ACTION_VARIANTS[rule.action]}
                >
                  {rule.action}
                </PolicyMetadataBadge>
              ),
            },
            {
              id: "scope",
              header: "Scope",
              className: "align-top whitespace-normal",
              cell: (rule) => (
                <span className="text-sm text-muted-foreground">
                  {rule.scope || "Global scope"}
                </span>
              ),
            },
            {
              id: "status",
              header: "Status",
              cell: (rule) => (
                <PolicyMetadataBadge
                  variant={rule.enabled === false ? "outline" : "default"}
                >
                  {rule.enabled === false ? "Disabled" : "Enabled"}
                </PolicyMetadataBadge>
              ),
            },
          ]}
          emptyTitle="No connection-specific firewall rules"
          emptyDescription="Use tenant defaults only, or add rules here when this connection needs stricter or looser SQL guardrails than the rest of the tenant."
          getKey={(rule, index) => rule.id ?? `${rule.name}-${index}`}
          getRowLabel={(rule) => rule.name}
          onEdit={openEdit}
          onDelete={(rule) => handleDelete(rule.id)}
        />
      </section>

      <ConnectionDialogDatabaseFirewallRuleDialog
        open={dialogOpen}
        editingRuleId={editingRuleId}
        formData={formData}
        patternError={patternError}
        onOpenChange={closeDialog}
        onApplyTemplate={applyTemplate}
        onSave={handleSave}
        onFieldChange={updateField}
        onPatternChange={(value) => {
          updateField("pattern", value);
          setPatternError(
            value.trim() ? validateDbFirewallPattern(value) : null,
          );
        }}
      />
    </>
  );
}
