import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SettingsPanel } from './settings-ui';

export function NoGatewayTenantState({ onNavigateToTab }: { onNavigateToTab?: (tabId: string) => void }) {
  return (
    <SettingsPanel
      title="Gateway access"
      description="Create or join an organization before managing gateways, sessions, and templates."
      contentClassName="space-y-4"
    >
      <Alert variant="warning">
        <AlertCircle className="size-4" />
        <AlertTitle>No organization yet</AlertTitle>
        <AlertDescription>
          Gateway administration is only available inside an organization workspace.
        </AlertDescription>
      </Alert>
      <Button type="button" onClick={() => onNavigateToTab?.('organization')}>
        Set Up Organization
      </Button>
    </SettingsPanel>
  );
}

export function GatewayPermissionsLoadingState() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Loading gateway permissions.
    </div>
  );
}

export function GatewayAccessRestrictedState() {
  return (
    <Alert variant="warning">
      <AlertCircle className="size-4" />
      <AlertTitle>Gateway access is restricted</AlertTitle>
      <AlertDescription>
        You do not have permission to view active sessions or manage gateways for this organization.
      </AlertDescription>
    </Alert>
  );
}
