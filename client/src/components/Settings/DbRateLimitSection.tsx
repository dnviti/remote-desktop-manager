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
import {
  createRateLimitPolicy,
  deleteRateLimitPolicy,
  getRateLimitPolicies,
  updateRateLimitPolicy,
  type DbQueryType,
  type RateLimitAction,
  type RateLimitPolicy,
  type RateLimitPolicyInput,
} from "../../api/dbAudit.api";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import {
  ALL_QUERY_TYPES,
  EMPTY_RATE_LIMIT_POLICY_FORM,
  formatRateLimitWindow,
  RATE_LIMIT_ACTION_VARIANTS,
  RATE_LIMIT_EXEMPT_ROLES,
  RATE_LIMIT_POLICY_TEMPLATES,
  RATE_LIMIT_QUERY_TYPE_OPTIONS,
  RATE_LIMIT_WINDOW_OPTIONS,
} from "./dbRateLimitPolicyConfig";
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

export default function DbRateLimitSection() {
  const [policies, setPolicies] = useState<RateLimitPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<RateLimitPolicy | null>(
    null,
  );
  const [formData, setFormData] = useState<RateLimitPolicyInput>(
    EMPTY_RATE_LIMIT_POLICY_FORM,
  );
  const { loading: saving, error, run, clearError } = useAsyncAction();

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      setPolicies(await getRateLimitPolicies());
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
    setFormData(EMPTY_RATE_LIMIT_POLICY_FORM);
    clearError();
  };

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditingPolicy(null);
      resetForm();
    }
  };

  const updateField = <K extends keyof RateLimitPolicyInput>(
    key: K,
    value: RateLimitPolicyInput[K],
  ) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const openCreate = () => {
    setEditingPolicy(null);
    resetForm();
    setDialogOpen(true);
  };

  const openEdit = (policy: RateLimitPolicy) => {
    setEditingPolicy(policy);
    setFormData({
      name: policy.name,
      queryType: policy.queryType,
      windowMs: policy.windowMs,
      maxQueries: policy.maxQueries,
      burstMax: policy.burstMax,
      exemptRoles: policy.exemptRoles,
      scope: policy.scope ?? "",
      action: policy.action,
      enabled: policy.enabled,
      priority: policy.priority,
    });
    clearError();
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

  const handleSave = async () => {
    const payload: RateLimitPolicyInput = {
      ...formData,
      queryType: formData.queryType || null,
      scope: formData.scope?.trim() ? formData.scope.trim() : null,
    };

    const isSuccessful = await run(async () => {
      if (editingPolicy) {
        await updateRateLimitPolicy(editingPolicy.id, payload);
      } else {
        await createRateLimitPolicy(payload);
      }
    }, "Failed to save rate limit policy");

    if (!isSuccessful) {
      return;
    }

    closeDialog(false);
    await fetchPolicies();
  };

  const handleDelete = async (policyId: string) => {
    const isSuccessful = await run(async () => {
      await deleteRateLimitPolicy(policyId);
    }, "Failed to delete rate limit policy");

    if (isSuccessful) {
      await fetchPolicies();
    }
  };

  return (
    <>
      <SettingsPanel
        title="Query Rate Limits"
        description="Cap noisy workloads, slow abuse, and decide whether overages are rejected or simply logged."
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
          <SettingsLoadingState message="Loading rate limit policies..." />
        ) : policies.length === 0 ? (
          <PolicyEmptyState
            title="No query rate limits"
            description="Queries are currently unrestricted. Add a policy when you need hard ceilings on read or write throughput."
          />
        ) : (
          <PolicyTable
            ariaLabel="Rate limit policies"
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
                    <span className="text-xs text-muted-foreground">
                      Priority {policy.priority}
                    </span>
                  </div>
                ),
              },
              {
                id: "query-type",
                header: "Query type",
                cell: (policy) => (
                  <PolicyMetadataBadge variant="outline">
                    {policy.queryType || "All query types"}
                  </PolicyMetadataBadge>
                ),
              },
              {
                id: "window",
                header: "Window",
                cell: (policy) => (
                  <span className="text-sm text-muted-foreground">
                    {formatRateLimitWindow(policy.windowMs)}
                  </span>
                ),
              },
              {
                id: "limits",
                header: "Limits",
                className: "align-top whitespace-normal",
                cell: (policy) => (
                  <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <span>Max {policy.maxQueries}</span>
                    <span>Burst {policy.burstMax}</span>
                  </div>
                ),
              },
              {
                id: "response",
                header: "Response",
                className: "align-top whitespace-normal",
                cell: (policy) => (
                  <div className="flex flex-col gap-2">
                    <PolicyMetadataBadge
                      variant={RATE_LIMIT_ACTION_VARIANTS[policy.action]}
                    >
                      {policy.action === "REJECT" ? "Reject" : "Log only"}
                    </PolicyMetadataBadge>
                    <span className="text-xs text-muted-foreground">
                      {policy.scope || "Global scope"}
                    </span>
                  </div>
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
            ]}
            emptyTitle="No query rate limits"
            emptyDescription="Queries are currently unrestricted. Add a policy when you need hard ceilings on read or write throughput."
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
        title={
          editingPolicy ? "Edit Rate Limit Policy" : "Create Rate Limit Policy"
        }
        description="Set the query type, time window, exempt roles, and response when a tenant crosses the limit."
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
              disabled={saving || !formData.name}
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
            description="Choose a baseline limit and then tune the scope, burst allowance, or exemptions for this tenant."
            templates={RATE_LIMIT_POLICY_TEMPLATES}
            onApply={applyTemplate}
          />
        )}

        <PolicyFormSection>
          <div className="grid gap-4 xl:grid-cols-2">
            <SettingsFieldCard
              label="Policy name"
              description="Keep the name readable in alerts and audit logs."
            >
              <Input
                aria-label="Policy name"
                value={formData.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </SettingsFieldCard>

            <SettingsFieldCard
              label="Response"
              description="Reject overages immediately or log them for review."
            >
              <Select
                value={formData.action ?? "REJECT"}
                onValueChange={(value) =>
                  updateField("action", value as RateLimitAction)
                }
              >
                <SelectTrigger aria-label="Rate limit action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REJECT">Reject excess queries</SelectItem>
                  <SelectItem value="LOG_ONLY">Log excess queries</SelectItem>
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
                  updateField(
                    "queryType",
                    value === ALL_QUERY_TYPES ? null : (value as DbQueryType),
                  )
                }
              >
                <SelectTrigger aria-label="Query type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_LIMIT_QUERY_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
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
                  updateField("windowMs", Number(value))
                }
              >
                <SelectTrigger aria-label="Time window">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_LIMIT_WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
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
                aria-label="Max queries"
                value={formData.maxQueries ?? 100}
                onChange={(event) => {
                  const nextValue =
                    Number.parseInt(event.target.value, 10) || 1;
                  updateField("maxQueries", Math.max(1, nextValue));
                }}
              />
            </SettingsFieldCard>

            <SettingsFieldCard
              label="Burst allowance"
              description="Short-term tokens available above the steady limit."
            >
              <Input
                type="number"
                min={1}
                aria-label="Burst max"
                value={formData.burstMax ?? 10}
                onChange={(event) => {
                  const nextValue =
                    Number.parseInt(event.target.value, 10) || 1;
                  updateField("burstMax", Math.max(1, nextValue));
                }}
              />
            </SettingsFieldCard>

            <SettingsFieldCard
              label="Priority"
              description="Higher priority policies are evaluated first."
            >
              <Input
                type="number"
                min={0}
                aria-label="Policy priority"
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
            label="Scope"
            description="Leave empty to apply the policy across every proxied database."
          >
            <Input
              aria-label="Policy scope"
              value={formData.scope ?? ""}
              placeholder="database or table name"
              onChange={(event) => updateField("scope", event.target.value)}
            />
          </SettingsFieldCard>

          <PolicyRoleChecklist
            label="Exempt roles"
            description="Selected tenant roles bypass this policy entirely."
            options={RATE_LIMIT_EXEMPT_ROLES}
            selected={formData.exemptRoles ?? []}
            onChange={(selected) => updateField("exemptRoles", selected)}
          />

          <SettingsSwitchRow
            title="Enable this policy"
            description="Disabled policies stay saved but do not participate in rate-limit decisions."
            checked={formData.enabled ?? true}
            onCheckedChange={(checked) => updateField("enabled", checked)}
          />
        </PolicyFormSection>
      </PolicyDialogShell>
    </>
  );
}
