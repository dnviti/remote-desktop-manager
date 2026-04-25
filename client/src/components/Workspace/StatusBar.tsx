import {
  Activity,
  Command,
  KeyRound,
  Lock,
  LockOpen,
  Network,
  ZoomIn,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useFeatureFlagsStore } from '@/store/featureFlagsStore';
import { useGatewayStore } from '@/store/gatewayStore';
import { useSecretStore } from '@/store/secretStore';
import { useVaultStore } from '@/store/vaultStore';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useUiPreferencesStore } from '@/store/uiPreferencesStore';
import { summarizeGatewayStatuses } from '@/utils/gatewayStatus';
import { broadcastVaultWindowSync } from '@/utils/vaultWindowSync';
import { lockVault } from '@/api/vault.api';

function StatusBarButton({
  children,
  onClick,
  tooltip,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tooltip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

interface StatusBarProps {
  onOpenSettings?: (tab?: string) => void;
  onOpenSessions?: () => void;
}

export default function StatusBar({ onOpenSettings, onOpenSessions }: StatusBarProps) {
  const user = useAuthStore((s) => s.user);
  const permissionsLoaded = useAuthStore((s) => s.permissionsLoaded);
  const canManageGateways = useAuthStore((s) => s.permissions.canManageGateways);
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const vaultInitialized = useVaultStore((s) => s.initialized);
  const setVaultUnlocked = useVaultStore((s) => s.setUnlocked);
  const checkVaultStatus = useVaultStore((s) => s.checkStatus);
  const keychainEnabled = useFeatureFlagsStore((s) => s.keychainEnabled);
  const featureFlagsLoaded = useFeatureFlagsStore((s) => s.loaded);
  const gateways = useGatewayStore((s) => s.gateways);
  const gatewaysLoading = useGatewayStore((s) => s.loading);
  const sessionCount = useGatewayStore((s) => s.sessionCount);
  const expiringCount = useSecretStore((s) => s.expiringCount);
  const pwnedCount = useSecretStore((s) => s.pwnedCount);
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  const uiZoomLevel = useUiPreferencesStore((s) => s.uiZoomLevel);
  const setPreference = useUiPreferencesStore((s) => s.set);

  const cycleZoom = () => {
    const steps = [100, 110, 120, 130];
    const idx = steps.indexOf(uiZoomLevel);
    const next = idx === -1 || idx === steps.length - 1 ? steps[0] : steps[idx + 1];
    setPreference('uiZoomLevel', next);
  };

  const gatewaySummary = summarizeGatewayStatuses(gateways);
  const alertCount = expiringCount + pwnedCount;
  const showGatewayStatus = permissionsLoaded && canManageGateways;
  const gatewayLabel = gatewaysLoading && gatewaySummary.total === 0
    ? 'Checking'
    : gatewaySummary.total === 0
      ? '0 gateways'
      : `${gatewaySummary.healthy}/${gatewaySummary.total}`;
  const gatewayTooltip = gatewaysLoading && gatewaySummary.total === 0
    ? 'Checking gateway health'
    : gatewaySummary.total === 0
      ? 'No gateways configured · Click to open gateways'
      : [
          `${gatewaySummary.healthy}/${gatewaySummary.total} gateways healthy`,
          gatewaySummary.degraded > 0 ? `${gatewaySummary.degraded} degraded` : '',
          gatewaySummary.unhealthy > 0 ? `${gatewaySummary.unhealthy} unhealthy` : '',
          gatewaySummary.unknown > 0 ? `${gatewaySummary.unknown} unknown` : '',
          'Click to open gateways',
        ].filter(Boolean).join(' · ');
  const gatewayIndicatorClass = gatewaysLoading && gatewaySummary.total === 0
    ? 'bg-sky-400 animate-pulse'
    : gatewaySummary.total === 0
      ? 'bg-zinc-400'
      : gatewaySummary.healthy === gatewaySummary.total
        ? 'bg-emerald-400'
        : gatewaySummary.healthy > 0 || gatewaySummary.degraded > 0
          ? 'bg-yellow-400'
          : gatewaySummary.unknown > 0
            ? 'bg-zinc-400'
            : 'bg-destructive';

  const handleVaultToggle = async () => {
    if (vaultUnlocked) {
      setVaultUnlocked(false);
      broadcastVaultWindowSync('lock');
      try {
        await lockVault();
      } catch {
        await checkVaultStatus();
      }
    }
    // When locked, clicking does nothing — the VaultLockedOverlay handles unlock
  };

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-background/85 px-2 text-[11px] backdrop-blur-xl">
      {/* Left side */}
      <div className="flex items-center gap-0.5">
        <StatusBarButton tooltip="Open sessions console" onClick={onOpenSessions}>
          <Activity className="size-3" />
          {sessionCount} session{sessionCount !== 1 ? 's' : ''}
        </StatusBarButton>

        {showGatewayStatus ? (
          <StatusBarButton
            tooltip={gatewayTooltip}
            onClick={() => onOpenSettings?.('infrastructure')}
          >
            <Network className="size-3" />
            <span className={cn('size-1.5 rounded-full', gatewayIndicatorClass)} />
            {gatewayLabel}
          </StatusBarButton>
        ) : null}
      </div>

      {/* Center — zoom indicator + command palette trigger */}
      <div className="flex items-center gap-0.5">
        <StatusBarButton tooltip="Zoom level (click to cycle)" onClick={cycleZoom}>
          <ZoomIn className="size-3" />
          {uiZoomLevel}%
        </StatusBarButton>
        <StatusBarButton tooltip="Command Palette (Cmd+K)" onClick={togglePalette} className="gap-1 text-muted-foreground/70">
          <Command className="size-3" />
          <span>Cmd+K</span>
        </StatusBarButton>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-0.5">
        {featureFlagsLoaded && keychainEnabled && vaultInitialized ? (
          <>
            <StatusBarButton
              tooltip={vaultUnlocked ? 'Click to lock vault' : 'Vault locked — unlock via overlay'}
              onClick={handleVaultToggle}
              className={vaultUnlocked ? 'text-primary' : 'text-destructive'}
            >
              {vaultUnlocked ? <LockOpen className="size-3" /> : <Lock className="size-3" />}
              {vaultUnlocked ? 'Open' : 'Locked'}
            </StatusBarButton>
            {alertCount > 0 ? (
              <StatusBarButton
                tooltip={`${expiringCount} expiring, ${pwnedCount} compromised`}
                className="text-destructive"
              >
                <KeyRound className="size-3" />
                {alertCount}
              </StatusBarButton>
            ) : null}
          </>
        ) : null}

        {user?.tenantRole ? (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
            {user.tenantRole}
          </Badge>
        ) : null}

        {user?.username || user?.email ? (
          <span className="max-w-24 truncate px-1 text-[11px] text-muted-foreground">
            {user.username || user.email}
          </span>
        ) : null}
      </div>
    </footer>
  );
}
