import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { EyeOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConnectionMaskingPolicy,
  DbSettings,
} from "../../api/connections.api";
import {
  EMPTY_MASKING_POLICY_FORM,
  MASKING_POLICY_TEMPLATES,
  MASKING_STRATEGY_LABELS,
  MASKING_STRATEGY_OPTIONS,
  MASKING_STRATEGY_VARIANTS,
  validateMaskingColumnPattern,
} from "../Settings/dbMaskingPolicyConfig";
import { PolicyMetadataBadge } from "../Settings/databasePolicyUi";
import ConnectionDialogDatabasePolicyControls from "./ConnectionDialogDatabasePolicyControls";
import ConnectionDialogDatabaseMaskingPolicyDialog from "./ConnectionDialogDatabaseMaskingPolicyDialog";
import ConnectionDialogPolicyTable from "./ConnectionDialogPolicyTable";
import {
  CONNECTION_DB_POLICY_MODE_OPTIONS,
  createConnectionPolicyId,
  trimOptionalText,
} from "./connectionDbPolicyHelpers";

interface ConnectionDialogDatabaseMaskingOverridesProps {
  dbSettings: Partial<DbSettings>;
  onChange: Dispatch<SetStateAction<Partial<DbSettings>>>;
}

function emptyPolicyForm(): ConnectionMaskingPolicy {
  return { ...EMPTY_MASKING_POLICY_FORM };
}

export default function ConnectionDialogDatabaseMaskingOverrides({
  dbSettings,
  onChange,
}: ConnectionDialogDatabaseMaskingOverridesProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [patternError, setPatternError] = useState<string | null>(null);
  const [formData, setFormData] =
    useState<ConnectionMaskingPolicy>(emptyPolicyForm());

  const policies = dbSettings.maskingPolicies ?? [];
  const mode = dbSettings.maskingPolicyMode ?? "inherit";
  const modeOption = useMemo(
    () =>
      CONNECTION_DB_POLICY_MODE_OPTIONS.find((option) => option.value === mode),
    [mode],
  );
  const selectedStrategy = MASKING_STRATEGY_OPTIONS.find(
    (entry) => entry.value === formData.strategy,
  );

  const resetForm = () => {
    setFormData(emptyPolicyForm());
    setPatternError(null);
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingPolicyId(null);
      resetForm();
    }
  };

  const updateField = <K extends keyof ConnectionMaskingPolicy>(
    key: K,
    value: ConnectionMaskingPolicy[K],
  ) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const openCreate = () => {
    setEditingPolicyId(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (policy: ConnectionMaskingPolicy) => {
    setEditingPolicyId(policy.id ?? null);
    setFormData({
      ...policy,
      scope: policy.scope ?? "",
      description: policy.description ?? "",
      exemptRoles: policy.exemptRoles ?? [],
      enabled: policy.enabled ?? true,
    });
    setPatternError(null);
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

  const handleSave = () => {
    const validationError = validateMaskingColumnPattern(
      formData.columnPattern ?? "",
    );
    if (validationError) {
      setPatternError(validationError);
      return;
    }

    const nextPolicy: ConnectionMaskingPolicy = {
      ...formData,
      id: formData.id ?? createConnectionPolicyId("masking"),
      name: formData.name.trim(),
      columnPattern: formData.columnPattern.trim(),
      strategy: formData.strategy,
      exemptRoles: formData.exemptRoles ?? [],
      scope: trimOptionalText(formData.scope),
      description: trimOptionalText(formData.description),
      enabled: formData.enabled !== false,
    };

    onChange((prev) => {
      const prevPolicies = prev.maskingPolicies ?? [];
      const nextPolicies = editingPolicyId
        ? prevPolicies.map((policy) =>
            policy.id === editingPolicyId ? nextPolicy : policy,
          )
        : [...prevPolicies, nextPolicy];
      return { ...prev, maskingPolicies: nextPolicies };
    });
    closeDialog(false);
  };

  const handleDelete = (policyId?: string) => {
    if (!policyId) {
      return;
    }
    onChange((prev) => ({
      ...prev,
      maskingPolicies: (prev.maskingPolicies ?? []).filter(
        (policy) => policy.id !== policyId,
      ),
    }));
  };

  return (
    <>
      <section className="flex flex-col gap-4 border-t border-border/60 pt-6 first:border-t-0 first:pt-0">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <EyeOff className="size-4 text-primary" />
              <h5 className="text-sm font-semibold">DB Masking</h5>
            </div>
            <p className="text-xs text-muted-foreground">
              Redact, hash, or partially reveal sensitive columns for this
              connection without forcing the same rules on every other database.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreate}
          >
            <Plus />
            Add Policy
          </Button>
        </div>

        <ConnectionDialogDatabasePolicyControls
          enabledTitle="Enable masking"
          enabledDescription="Disable this only when query results from this connection must bypass both tenant-wide and connection-specific masking policies."
          enabled={dbSettings.maskingEnabled !== false}
          onEnabledChange={(checked) =>
            onChange((prev) => ({ ...prev, maskingEnabled: checked }))
          }
          mode={mode}
          modeDescription={modeOption?.description}
          selectId="db-masking-mode"
          onModeChange={(value) =>
            onChange((prev) => ({
              ...prev,
              maskingPolicyMode: value,
            }))
          }
        />

        <ConnectionDialogPolicyTable
          ariaLabel="Connection masking policies"
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
              id: "roles",
              header: "Exempt roles",
              className: "align-top whitespace-normal",
              cell: (policy) => (
                <span className="text-sm text-muted-foreground">
                  {policy.exemptRoles?.length
                    ? policy.exemptRoles.join(", ")
                    : "None"}
                </span>
              ),
            },
            {
              id: "status",
              header: "Status",
              cell: (policy) => (
                <PolicyMetadataBadge
                  variant={policy.enabled === false ? "outline" : "default"}
                >
                  {policy.enabled === false ? "Disabled" : "Enabled"}
                </PolicyMetadataBadge>
              ),
            },
          ]}
          emptyTitle="No connection-specific masking policies"
          emptyDescription="Use tenant defaults only, or add policies here when this connection needs its own masking behavior for PII, financial data, or secrets."
          getKey={(policy, index) => policy.id ?? `${policy.name}-${index}`}
          getRowLabel={(policy) => policy.name}
          onEdit={openEdit}
          onDelete={(policy) => handleDelete(policy.id)}
        />
      </section>

      <ConnectionDialogDatabaseMaskingPolicyDialog
        open={dialogOpen}
        editingPolicyId={editingPolicyId}
        formData={formData}
        patternError={patternError}
        selectedStrategyDescription={selectedStrategy?.description}
        onOpenChange={closeDialog}
        onApplyTemplate={applyTemplate}
        onSave={handleSave}
        onFieldChange={updateField}
        onPatternChange={(value) => {
          updateField("columnPattern", value);
          setPatternError(
            value.trim() ? validateMaskingColumnPattern(value) : null,
          );
        }}
      />
    </>
  );
}
