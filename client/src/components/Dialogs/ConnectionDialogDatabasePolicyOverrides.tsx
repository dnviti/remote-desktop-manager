import type { Dispatch, SetStateAction } from "react";
import type { DbSettings } from "../../api/connections.api";
import ConnectionDialogDatabaseFirewallOverrides from "./ConnectionDialogDatabaseFirewallOverrides";
import ConnectionDialogDatabaseMaskingOverrides from "./ConnectionDialogDatabaseMaskingOverrides";
import ConnectionDialogDatabaseRateLimitOverrides from "./ConnectionDialogDatabaseRateLimitOverrides";

interface ConnectionDialogDatabasePolicyOverridesProps {
  dbSettings: Partial<DbSettings>;
  onChange: Dispatch<SetStateAction<Partial<DbSettings>>>;
}

export default function ConnectionDialogDatabasePolicyOverrides({
  dbSettings,
  onChange,
}: ConnectionDialogDatabasePolicyOverridesProps) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/30 p-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold">
          Connection-level query controls
        </h4>
        <p className="text-xs text-muted-foreground">
          Keep tenant-wide defaults in Settings, then inherit, merge, or
          override them per connection for maximum flexibility.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <ConnectionDialogDatabaseFirewallOverrides
          dbSettings={dbSettings}
          onChange={onChange}
        />
        <ConnectionDialogDatabaseMaskingOverrides
          dbSettings={dbSettings}
          onChange={onChange}
        />
        <ConnectionDialogDatabaseRateLimitOverrides
          dbSettings={dbSettings}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
