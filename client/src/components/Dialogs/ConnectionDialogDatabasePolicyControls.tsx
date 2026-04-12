import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DbPolicyOverrideMode } from "../../api/connections.api";
import { SettingsSwitchRow } from "../Settings/settings-ui";
import { CONNECTION_DB_POLICY_MODE_OPTIONS } from "./connectionDbPolicyHelpers";

interface ConnectionDialogDatabasePolicyControlsProps {
  enabledTitle: string;
  enabledDescription: string;
  enabled: boolean;
  onEnabledChange: (checked: boolean) => void;
  mode: DbPolicyOverrideMode;
  modeDescription?: string;
  selectId: string;
  onModeChange: (mode: DbPolicyOverrideMode) => void;
}

export default function ConnectionDialogDatabasePolicyControls({
  enabledTitle,
  enabledDescription,
  enabled,
  onEnabledChange,
  mode,
  modeDescription,
  selectId,
  onModeChange,
}: ConnectionDialogDatabasePolicyControlsProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start">
      <SettingsSwitchRow
        title={enabledTitle}
        description={enabledDescription}
        checked={enabled}
        onCheckedChange={onEnabledChange}
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border/60 px-4 py-3">
        <Label
          htmlFor={selectId}
          className="text-sm font-medium text-foreground"
        >
          Policy source
        </Label>
        <Select
          value={mode}
          onValueChange={(value) => onModeChange(value as DbPolicyOverrideMode)}
        >
          <SelectTrigger id={selectId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {CONNECTION_DB_POLICY_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{modeDescription}</p>
      </div>
    </div>
  );
}
