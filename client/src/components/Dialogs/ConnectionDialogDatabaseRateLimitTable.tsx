import type { ConnectionRateLimitPolicy } from "../../api/connections.api";
import {
  formatRateLimitWindow,
  RATE_LIMIT_ACTION_VARIANTS,
} from "../Settings/dbRateLimitPolicyConfig";
import { PolicyMetadataBadge } from "../Settings/databasePolicyUi";
import ConnectionDialogPolicyTable from "./ConnectionDialogPolicyTable";

interface ConnectionDialogDatabaseRateLimitTableProps {
  policies: ConnectionRateLimitPolicy[];
  onEdit: (policy: ConnectionRateLimitPolicy) => void;
  onDelete: (policyId?: string) => void;
}

export default function ConnectionDialogDatabaseRateLimitTable({
  policies,
  onEdit,
  onDelete,
}: ConnectionDialogDatabaseRateLimitTableProps) {
  return (
    <ConnectionDialogPolicyTable
      ariaLabel="Connection rate limit policies"
      items={policies}
      columns={[
        {
          id: "name",
          header: "Policy",
          className: "align-top whitespace-normal",
          cell: (policy) => (
            <div className="flex min-w-[14rem] flex-col gap-1">
              <span className="font-medium text-foreground">{policy.name}</span>
              <span className="text-xs text-muted-foreground">
                Priority {policy.priority ?? 0}
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
              {formatRateLimitWindow(policy.windowMs ?? 60000)}
            </span>
          ),
        },
        {
          id: "limits",
          header: "Limits",
          className: "align-top whitespace-normal",
          cell: (policy) => (
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span>Max {policy.maxQueries ?? 100}</span>
              <span>Burst {policy.burstMax ?? 10}</span>
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
                variant={RATE_LIMIT_ACTION_VARIANTS[policy.action ?? "REJECT"]}
              >
                {policy.action === "LOG_ONLY" ? "Log only" : "Reject"}
              </PolicyMetadataBadge>
              <span className="text-xs text-muted-foreground">
                {policy.scope || "Global scope"}
              </span>
            </div>
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
      emptyTitle="No connection-specific rate limits"
      emptyDescription="Use tenant defaults only, or add policies here when this connection needs its own throughput ceiling or abuse controls."
      getKey={(policy, index) => policy.id ?? `${policy.name}-${index}`}
      getRowLabel={(policy) => policy.name}
      onEdit={onEdit}
      onDelete={(policy) => onDelete(policy.id)}
    />
  );
}
