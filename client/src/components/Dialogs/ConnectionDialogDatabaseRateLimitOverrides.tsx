import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Gauge, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConnectionRateLimitPolicy,
  DbSettings,
} from "../../api/connections.api";
import {
  EMPTY_RATE_LIMIT_POLICY_FORM,
  RATE_LIMIT_POLICY_TEMPLATES,
} from "../Settings/dbRateLimitPolicyConfig";
import ConnectionDialogDatabasePolicyControls from "./ConnectionDialogDatabasePolicyControls";
import ConnectionDialogDatabaseRateLimitPolicyDialog from "./ConnectionDialogDatabaseRateLimitPolicyDialog";
import ConnectionDialogDatabaseRateLimitTable from "./ConnectionDialogDatabaseRateLimitTable";
import {
  CONNECTION_DB_POLICY_MODE_OPTIONS,
  createConnectionPolicyId,
  trimOptionalText,
} from "./connectionDbPolicyHelpers";

interface ConnectionDialogDatabaseRateLimitOverridesProps {
  dbSettings: Partial<DbSettings>;
  onChange: Dispatch<SetStateAction<Partial<DbSettings>>>;
}

function emptyPolicyForm(): ConnectionRateLimitPolicy {
  return { ...EMPTY_RATE_LIMIT_POLICY_FORM };
}

export default function ConnectionDialogDatabaseRateLimitOverrides({
  dbSettings,
  onChange,
}: ConnectionDialogDatabaseRateLimitOverridesProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicyId, setEditingPolicyId] = useState<string | null>(null);
  const [formData, setFormData] =
    useState<ConnectionRateLimitPolicy>(emptyPolicyForm());

  const policies = dbSettings.rateLimitPolicies ?? [];
  const mode = dbSettings.rateLimitPolicyMode ?? "inherit";
  const modeOption = useMemo(
    () =>
      CONNECTION_DB_POLICY_MODE_OPTIONS.find((option) => option.value === mode),
    [mode],
  );

  const resetForm = () => {
    setFormData(emptyPolicyForm());
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingPolicyId(null);
      resetForm();
    }
  };

  const updateField = <K extends keyof ConnectionRateLimitPolicy>(
    key: K,
    value: ConnectionRateLimitPolicy[K],
  ) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const openCreate = () => {
    setEditingPolicyId(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (policy: ConnectionRateLimitPolicy) => {
    setEditingPolicyId(policy.id ?? null);
    setFormData({
      ...policy,
      queryType: policy.queryType ?? null,
      exemptRoles: policy.exemptRoles ?? [],
      scope: policy.scope ?? "",
      enabled: policy.enabled ?? true,
      priority: policy.priority ?? 0,
      windowMs: policy.windowMs ?? 60000,
      maxQueries: policy.maxQueries ?? 100,
      burstMax: policy.burstMax ?? 10,
      action: policy.action ?? "REJECT",
    });
    setDialogOpen(true);
  };

  const applyTemplate = (templateName: string) => {
    const template = RATE_LIMIT_POLICY_TEMPLATES.find(
      (entry) => entry.name === templateName,
    );
    if (!template) {
      return;
    }

    setFormData((current) => ({
      ...current,
      name: template.name,
      queryType: template.queryType,
      windowMs: template.windowMs,
      maxQueries: template.maxQueries,
      burstMax: template.burstMax,
      action: template.action,
    }));
  };

  const handleSave = () => {
    const nextPolicy: ConnectionRateLimitPolicy = {
      ...formData,
      id: formData.id ?? createConnectionPolicyId("rate-limit"),
      name: formData.name.trim(),
      queryType: formData.queryType || null,
      windowMs: Math.max(1, formData.windowMs ?? 60000),
      maxQueries: Math.max(1, formData.maxQueries ?? 100),
      burstMax: Math.max(1, formData.burstMax ?? 10),
      exemptRoles: formData.exemptRoles ?? [],
      scope: trimOptionalText(formData.scope) ?? null,
      action: formData.action ?? "REJECT",
      enabled: formData.enabled !== false,
      priority: Number.isFinite(formData.priority)
        ? Number(formData.priority)
        : 0,
    };

    onChange((prev) => {
      const prevPolicies = prev.rateLimitPolicies ?? [];
      const nextPolicies = editingPolicyId
        ? prevPolicies.map((policy) =>
            policy.id === editingPolicyId ? nextPolicy : policy,
          )
        : [...prevPolicies, nextPolicy];
      return { ...prev, rateLimitPolicies: nextPolicies };
    });
    closeDialog(false);
  };

  const handleDelete = (policyId?: string) => {
    if (!policyId) {
      return;
    }
    onChange((prev) => ({
      ...prev,
      rateLimitPolicies: (prev.rateLimitPolicies ?? []).filter(
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
              <Gauge className="size-4 text-primary" />
              <h5 className="text-sm font-semibold">DB Rate Limits</h5>
            </div>
            <p className="text-xs text-muted-foreground">
              Throttle noisy workloads on this connection without forcing the
              same ceilings on every database in the tenant.
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
          enabledTitle="Enable rate limiting"
          enabledDescription="Disable this only when the connection must bypass both tenant-wide and connection-specific rate-limit policies."
          enabled={dbSettings.rateLimitEnabled !== false}
          onEnabledChange={(checked) =>
            onChange((prev) => ({ ...prev, rateLimitEnabled: checked }))
          }
          mode={mode}
          modeDescription={modeOption?.description}
          selectId="db-rate-limit-mode"
          onModeChange={(value) =>
            onChange((prev) => ({
              ...prev,
              rateLimitPolicyMode: value,
            }))
          }
        />

        <ConnectionDialogDatabaseRateLimitTable
          policies={policies}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      </section>

      <ConnectionDialogDatabaseRateLimitPolicyDialog
        open={dialogOpen}
        editingPolicyId={editingPolicyId}
        formData={formData}
        onOpenChange={closeDialog}
        onApplyTemplate={applyTemplate}
        onSave={handleSave}
        onFieldChange={updateField}
      />
    </>
  );
}
