import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PolicyTable from "@/components/shared/PolicyTable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createFirewallRule,
  deleteFirewallRule,
  getFirewallRules,
  updateFirewallRule,
  type FirewallAction,
  type FirewallRule,
  type FirewallRuleInput,
} from "../../api/dbAudit.api";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { validateDbFirewallPattern } from "../../utils/dbFirewallPattern";
import {
  EMPTY_FIREWALL_RULE_FORM,
  FIREWALL_ACTION_VARIANTS,
  FIREWALL_RULE_TEMPLATES,
} from "./dbFirewallPolicyConfig";
import {
  PolicyDialogShell,
  PolicyEmptyState,
  PolicyFormSection,
  PolicyMetadataBadge,
  PolicyTemplatePicker,
} from "./databasePolicyUi";
import {
  SettingsFieldCard,
  SettingsLoadingState,
  SettingsPanel,
  SettingsSwitchRow,
} from "./settings-ui";

export default function DbFirewallSection() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FirewallRule | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const [formData, setFormData] = useState<FirewallRuleInput>(
    EMPTY_FIREWALL_RULE_FORM,
  );
  const { loading: saving, error, run, clearError } = useAsyncAction();

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await getFirewallRules());
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  const resetForm = () => {
    setFormData(EMPTY_FIREWALL_RULE_FORM);
    setPatternError(null);
    clearError();
  };

  const openCreate = () => {
    setEditingRule(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (rule: FirewallRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      pattern: rule.pattern,
      action: rule.action,
      scope: rule.scope ?? "",
      description: rule.description ?? "",
      enabled: rule.enabled,
      priority: rule.priority,
    });
    setPatternError(null);
    clearError();
    setDialogOpen(true);
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingRule(null);
      resetForm();
    }
  };

  const updateField = <K extends keyof FirewallRuleInput>(
    key: K,
    value: FirewallRuleInput[K],
  ) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const updatePattern = (value: string) => {
    updateField("pattern", value);
    setPatternError(value.trim() ? validateDbFirewallPattern(value) : null);
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

  const handleSave = async () => {
    const regexError = validateDbFirewallPattern(formData.pattern);
    if (regexError) {
      setPatternError(regexError);
      return;
    }

    const isSuccessful = await run(async () => {
      if (editingRule) {
        await updateFirewallRule(editingRule.id, formData);
      } else {
        await createFirewallRule(formData);
      }
    }, "Failed to save firewall rule");

    if (!isSuccessful) {
      return;
    }

    closeDialog(false);
    await fetchRules();
  };

  const handleDelete = async (ruleId: string) => {
    const isSuccessful = await run(async () => {
      await deleteFirewallRule(ruleId);
    }, "Failed to delete firewall rule");

    if (isSuccessful) {
      await fetchRules();
    }
  };

  return (
    <>
      <SettingsPanel
        title="SQL Firewall Rules"
        description="Block, alert, or log suspicious SQL patterns before they become an incident."
        heading={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreate}
          >
            <Plus />
            Add Rule
          </Button>
        }
        contentClassName="space-y-4"
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <SettingsLoadingState message="Loading firewall rules..." />
        ) : rules.length === 0 ? (
          <PolicyEmptyState
            title="No custom firewall rules"
            description="Built-in protections still apply. Add custom rules when you need tenant-specific blocking, alerting, or audit coverage."
          />
        ) : (
          <PolicyTable
            ariaLabel="Firewall rules"
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
                      Priority {rule.priority}
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
                    variant={rule.enabled ? "default" : "outline"}
                  >
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </PolicyMetadataBadge>
                ),
              },
              {
                id: "updated",
                header: "Updated",
                className: "align-top whitespace-normal",
                cell: (rule) => (
                  <span className="text-xs text-muted-foreground">
                    {new Date(rule.updatedAt).toLocaleString()}
                  </span>
                ),
              },
            ]}
            emptyTitle="No custom firewall rules"
            emptyDescription="Built-in protections still apply. Add custom rules when you need tenant-specific blocking, alerting, or audit coverage."
            getKey={(rule) => rule.id}
            getRowLabel={(rule) => rule.name}
            onEdit={openEdit}
            onDelete={(rule) => void handleDelete(rule.id)}
          />
        )}
      </SettingsPanel>

      <PolicyDialogShell
        open={dialogOpen}
        onOpenChange={closeDialog}
        title={editingRule ? "Edit Firewall Rule" : "Create Firewall Rule"}
        description="Define the SQL pattern, response action, and optional scope for this rule."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => closeDialog(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={
                saving ||
                !formData.name ||
                !formData.pattern ||
                Boolean(patternError)
              }
            >
              {saving
                ? "Saving..."
                : editingRule
                  ? "Update Rule"
                  : "Create Rule"}
            </Button>
          </>
        }
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!editingRule && (
          <PolicyTemplatePicker
            title="Start from a template"
            description="Seed the rule with a proven pattern, then adjust the scope or priority for this tenant."
            templates={FIREWALL_RULE_TEMPLATES}
            onApply={applyTemplate}
          />
        )}

        <PolicyFormSection>
          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsFieldCard
              label="Rule name"
              description="Use a short name that reads well in audit events."
            >
              <Input
                aria-label="Rule name"
                value={formData.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </SettingsFieldCard>

            <SettingsFieldCard
              label="Action"
              description="Choose whether matching queries are blocked, alerted, or only logged."
            >
              <Select
                value={formData.action}
                onValueChange={(value) =>
                  updateField("action", value as FirewallAction)
                }
              >
                <SelectTrigger aria-label="Firewall action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BLOCK">Block execution</SelectItem>
                  <SelectItem value="ALERT">Allow and alert</SelectItem>
                  <SelectItem value="LOG">Allow and log</SelectItem>
                </SelectContent>
              </Select>
            </SettingsFieldCard>
          </div>

          <SettingsFieldCard
            label="Regex pattern"
            description="Patterns are evaluated server-side on SQL text before execution."
          >
            <Input
              aria-label="Regex pattern"
              value={formData.pattern}
              onChange={(event) => updatePattern(event.target.value)}
              className="font-mono text-xs"
            />
            <p
              className={`mt-2 text-xs ${patternError ? "text-destructive" : "text-muted-foreground"}`}
            >
              {patternError ??
                "Basic regex safety checks run locally before the backend validates the final expression."}
            </p>
          </SettingsFieldCard>

          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsFieldCard
              label="Scope"
              description="Leave empty to apply this rule across every proxied database."
            >
              <Input
                aria-label="Rule scope"
                value={formData.scope ?? ""}
                placeholder="database or table name"
                onChange={(event) => updateField("scope", event.target.value)}
              />
            </SettingsFieldCard>

            <SettingsFieldCard
              label="Priority"
              description="Higher priority rules are evaluated before lower-priority rules."
            >
              <Input
                type="number"
                min={0}
                aria-label="Rule priority"
                value={formData.priority ?? 0}
                onChange={(event) => {
                  const nextValue =
                    Number.parseInt(event.target.value, 10) || 0;
                  updateField("priority", Math.max(0, nextValue));
                }}
              />
            </SettingsFieldCard>
          </div>

          <SettingsFieldCard
            label="Description"
            description="Optional context for responders reviewing why this rule exists."
          >
            <Textarea
              aria-label="Rule description"
              value={formData.description ?? ""}
              onChange={(event) =>
                updateField("description", event.target.value)
              }
            />
          </SettingsFieldCard>

          <SettingsSwitchRow
            title="Enable this rule"
            description="Disabled rules stay defined but are ignored during query evaluation."
            checked={formData.enabled ?? true}
            onCheckedChange={(checked) => updateField("enabled", checked)}
          />
        </PolicyFormSection>
      </PolicyDialogShell>
    </>
  );
}
