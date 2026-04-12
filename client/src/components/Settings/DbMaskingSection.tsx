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
  createMaskingPolicy,
  deleteMaskingPolicy,
  getMaskingPolicies,
  updateMaskingPolicy,
  type MaskingPolicy,
  type MaskingPolicyInput,
  type MaskingStrategy,
} from "../../api/dbAudit.api";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import {
  EMPTY_MASKING_POLICY_FORM,
  MASKING_EXEMPT_ROLES,
  MASKING_POLICY_TEMPLATES,
  MASKING_STRATEGY_LABELS,
  MASKING_STRATEGY_OPTIONS,
  MASKING_STRATEGY_VARIANTS,
  validateMaskingColumnPattern,
} from "./dbMaskingPolicyConfig";
import {
  PolicyDialogShell,
  PolicyEmptyState,
  PolicyFormSection,
  PolicyMetadataBadge,
  PolicyRoleChecklist,
  PolicyTemplatePicker,
} from "./databasePolicyUi";
import {
  SettingsFieldCard,
  SettingsLoadingState,
  SettingsPanel,
  SettingsSwitchRow,
} from "./settings-ui";

export default function DbMaskingSection() {
  const [policies, setPolicies] = useState<MaskingPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<MaskingPolicy | null>(
    null,
  );
  const [patternError, setPatternError] = useState<string | null>(null);
  const [formData, setFormData] = useState<MaskingPolicyInput>(
    EMPTY_MASKING_POLICY_FORM,
  );
  const { loading: saving, error, run, clearError } = useAsyncAction();

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      setPolicies(await getMaskingPolicies());
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  const resetForm = () => {
    setFormData(EMPTY_MASKING_POLICY_FORM);
    setPatternError(null);
    clearError();
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingPolicy(null);
      resetForm();
    }
  };

  const updateField = <K extends keyof MaskingPolicyInput>(
    key: K,
    value: MaskingPolicyInput[K],
  ) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const updatePattern = (value: string) => {
    updateField("columnPattern", value);
    setPatternError(value.trim() ? validateMaskingColumnPattern(value) : null);
  };

  const openCreate = () => {
    setEditingPolicy(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (policy: MaskingPolicy) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name,
      columnPattern: policy.columnPattern,
      strategy: policy.strategy,
      exemptRoles: policy.exemptRoles,
      scope: policy.scope ?? "",
      description: policy.description ?? "",
      enabled: policy.enabled,
    });
    setPatternError(null);
    clearError();
    setDialogOpen(true);
  };

  const applyTemplate = (templateName: string) => {
    const template = MASKING_POLICY_TEMPLATES.find(
      (entry) => entry.name === templateName,
    );
    if (!template) {
      return;
    }

    setFormData((current) => ({
      ...current,
      name: template.name,
      columnPattern: template.columnPattern,
      strategy: template.strategy,
      description: template.description,
    }));
    setPatternError(validateMaskingColumnPattern(template.columnPattern));
  };

  const handleSave = async () => {
    const validationError = validateMaskingColumnPattern(
      formData.columnPattern,
    );
    if (validationError) {
      setPatternError(validationError);
      return;
    }

    const payload: MaskingPolicyInput = {
      ...formData,
      scope: formData.scope?.trim() || undefined,
      description: formData.description?.trim() || undefined,
    };

    const isSuccessful = await run(async () => {
      if (editingPolicy) {
        await updateMaskingPolicy(editingPolicy.id, payload);
      } else {
        await createMaskingPolicy(payload);
      }
    }, "Failed to save masking policy");

    if (!isSuccessful) {
      return;
    }

    closeDialog(false);
    await fetchPolicies();
  };

  const handleDelete = async (policyId: string) => {
    const isSuccessful = await run(async () => {
      await deleteMaskingPolicy(policyId);
    }, "Failed to delete masking policy");

    if (isSuccessful) {
      await fetchPolicies();
    }
  };

  const selectedStrategy = MASKING_STRATEGY_OPTIONS.find(
    (entry) => entry.value === formData.strategy,
  );

  return (
    <>
      <SettingsPanel
        title="Data Masking Policies"
        description="Redact, hash, or partially reveal sensitive columns before query results leave the proxy."
        heading={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreate}
          >
            <Plus />
            Add Policy
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
          <SettingsLoadingState message="Loading masking policies..." />
        ) : policies.length === 0 ? (
          <PolicyEmptyState
            title="No masking policies"
            description="Query results currently return raw column values. Add policies when you need tenant-specific protection for PII, financial data, or credentials."
          />
        ) : (
          <PolicyTable
            ariaLabel="Masking policies"
            items={policies}
            columns={[
              {
                id: "name",
                header: "Policy",
                className: "align-top whitespace-normal",
                cell: (policy) => (
                  <div className="flex min-w-[14rem] flex-col gap-1">
                    <span className="font-medium text-foreground">
                      {policy.name}
                    </span>
                    {policy.description ? (
                      <span className="text-xs text-muted-foreground">
                        {policy.description}
                      </span>
                    ) : null}
                  </div>
                ),
              },
              {
                id: "pattern",
                header: "Column pattern",
                className: "align-top whitespace-normal",
                cell: (policy) => (
                  <code className="block max-w-[24rem] break-all rounded-md bg-muted/40 px-2 py-1 font-mono text-xs text-foreground">
                    {policy.columnPattern}
                  </code>
                ),
              },
              {
                id: "strategy",
                header: "Strategy",
                cell: (policy) => (
                  <PolicyMetadataBadge
                    variant={MASKING_STRATEGY_VARIANTS[policy.strategy]}
                  >
                    {MASKING_STRATEGY_LABELS[policy.strategy]}
                  </PolicyMetadataBadge>
                ),
              },
              {
                id: "roles",
                header: "Exempt roles",
                className: "align-top whitespace-normal",
                cell: (policy) => (
                  <span className="text-sm text-muted-foreground">
                    {policy.exemptRoles.length > 0
                      ? policy.exemptRoles.join(", ")
                      : "None"}
                  </span>
                ),
              },
              {
                id: "scope",
                header: "Scope",
                className: "align-top whitespace-normal",
                cell: (policy) => (
                  <span className="text-sm text-muted-foreground">
                    {policy.scope || "Global scope"}
                  </span>
                ),
              },
              {
                id: "status",
                header: "Status",
                cell: (policy) => (
                  <PolicyMetadataBadge
                    variant={policy.enabled ? "default" : "outline"}
                  >
                    {policy.enabled ? "Enabled" : "Disabled"}
                  </PolicyMetadataBadge>
                ),
              },
              {
                id: "updated",
                header: "Updated",
                className: "align-top whitespace-normal",
                cell: (policy) => (
                  <span className="text-xs text-muted-foreground">
                    {new Date(policy.updatedAt).toLocaleString()}
                  </span>
                ),
              },
            ]}
            emptyTitle="No masking policies"
            emptyDescription="Query results currently return raw column values. Add policies when you need tenant-specific protection for PII, financial data, or credentials."
            getKey={(policy) => policy.id}
            getRowLabel={(policy) => policy.name}
            onEdit={openEdit}
            onDelete={(policy) => void handleDelete(policy.id)}
          />
        )}
      </SettingsPanel>

      <PolicyDialogShell
        open={dialogOpen}
        onOpenChange={closeDialog}
        title={editingPolicy ? "Edit Masking Policy" : "Create Masking Policy"}
        description="Choose how matching columns should be transformed and which tenant roles can bypass the mask."
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
                !formData.columnPattern ||
                Boolean(patternError)
              }
            >
              {saving
                ? "Saving..."
                : editingPolicy
                  ? "Update Policy"
                  : "Create Policy"}
            </Button>
          </>
        }
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!editingPolicy && (
          <PolicyTemplatePicker
            title="Start from a template"
            description="Use a proven pattern for common sensitive columns, then adapt the scope or exemptions for this tenant."
            templates={MASKING_POLICY_TEMPLATES}
            onApply={applyTemplate}
          />
        )}

        <PolicyFormSection>
          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsFieldCard
              label="Policy name"
              description="Use a readable name that makes incident review fast."
            >
              <Input
                aria-label="Policy name"
                value={formData.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </SettingsFieldCard>

            <SettingsFieldCard
              label="Masking strategy"
              description="Choose how matched column values should be transformed."
            >
              <Select
                value={formData.strategy}
                onValueChange={(value) =>
                  updateField("strategy", value as MaskingStrategy)
                }
              >
                <SelectTrigger aria-label="Masking strategy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MASKING_STRATEGY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-muted-foreground">
                {selectedStrategy?.description}
              </p>
            </SettingsFieldCard>
          </div>

          <SettingsFieldCard
            label="Column pattern"
            description="Use a regular expression that matches sensitive column names such as email, password, or credit_card."
          >
            <Input
              aria-label="Column pattern"
              value={formData.columnPattern}
              onChange={(event) => updatePattern(event.target.value)}
              className="font-mono text-xs"
            />
            <p
              className={`mt-2 text-xs ${patternError ? "text-destructive" : "text-muted-foreground"}`}
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
            onChange={(selected) => updateField("exemptRoles", selected)}
          />

          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsFieldCard
              label="Scope"
              description="Leave empty to apply the policy across every proxied database and table."
            >
              <Input
                aria-label="Policy scope"
                value={formData.scope ?? ""}
                placeholder="database or table name"
                onChange={(event) => updateField("scope", event.target.value)}
              />
            </SettingsFieldCard>

            <SettingsFieldCard
              label="Description"
              description="Optional context for reviewers explaining why this mask exists."
            >
              <Textarea
                aria-label="Policy description"
                value={formData.description ?? ""}
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
              />
            </SettingsFieldCard>
          </div>

          <SettingsSwitchRow
            title="Enable this policy"
            description="Disabled policies stay defined but no longer transform query results."
            checked={formData.enabled ?? true}
            onCheckedChange={(checked) => updateField("enabled", checked)}
          />
        </PolicyFormSection>
      </PolicyDialogShell>
    </>
  );
}
