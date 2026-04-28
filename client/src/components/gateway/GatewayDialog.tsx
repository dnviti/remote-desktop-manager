import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Save,
  Lock,
  Copy,
  RefreshCw,
  Trash2,
  Power,
  History,
  Gauge,
  Rocket,
  Loader2,
} from 'lucide-react';
import { useGatewayStore } from '../../store/gatewayStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import type {
  GatewayData,
  GatewayDeploymentMode,
  TunnelEventData,
  TunnelMetricsData,
} from '../../api/gateway.api';
import {
  forceDisconnectTunnel as forceDisconnectApi,
  getTunnelEvents as getTunnelEventsApi,
  getTunnelMetrics as getTunnelMetricsApi,
} from '../../api/gateway.api';
import SessionTimeoutConfig from '../orchestration/SessionTimeoutConfig';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { extractApiError } from '../../utils/apiError';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import GatewayEgressPolicyEditor from './GatewayEgressPolicyEditor';

interface GatewayDialogProps {
  open: boolean;
  onClose: () => void;
  gateway?: GatewayData | null;
}

export default function GatewayDialog({ open, onClose, gateway }: GatewayDialogProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH' | 'DB_PROXY'>('GUACD');
  const [deploymentMode, setDeploymentMode] = useState<GatewayDeploymentMode>('SINGLE_INSTANCE');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [apiPort, setApiPort] = useState('');
  const [monitoringEnabled, setMonitoringEnabled] = useState(true);
  const [monitorIntervalMs, setMonitorIntervalMs] = useState('5000');
  const [inactivityTimeout, setInactivityTimeout] = useState('60');
  const [autoScaleEnabled, setAutoScaleEnabled] = useState(false);
  const [minReplicasVal, setMinReplicasVal] = useState('0');
  const [maxReplicasVal, setMaxReplicasVal] = useState('5');
  const [sessPerInstance, setSessPerInstance] = useState('10');
  const [cooldownVal, setCooldownVal] = useState('300');
  const [publishPorts, setPublishPorts] = useState(false);
  const [lbStrategy, setLbStrategy] = useState<'ROUND_ROBIN' | 'LEAST_CONNECTIONS'>('ROUND_ROBIN');

  const [tunnelToken, setTunnelToken] = useState<string | null>(null);
  const [tunnelDeploying, setTunnelDeploying] = useState(false);
  const [tunnelError, setTunnelError] = useState('');
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);
  const [tunnelEvents, setTunnelEvents] = useState<TunnelEventData[]>([]);
  const [tunnelEventsLoading, setTunnelEventsLoading] = useState(false);
  const [tunnelMetrics, setTunnelMetrics] = useState<TunnelMetricsData | null>(null);
  const [tunnelMetricsLoading, setTunnelMetricsLoading] = useState(false);

  const { loading, error, setError, run } = useAsyncAction();
  const { loading: scalingSaving, run: runScaling } = useAsyncAction();
  const { loading: tunnelActionLoading, run: runTunnelAction } = useAsyncAction();

  const createGateway = useGatewayStore((s) => s.createGateway);
  const updateGateway = useGatewayStore((s) => s.updateGateway);
  const updateScalingConfig = useGatewayStore((s) => s.updateScalingConfig);
  const generateTunnelTokenAction = useGatewayStore((s) => s.generateTunnelToken);
  const revokeTunnelTokenAction = useGatewayStore((s) => s.revokeTunnelToken);
  const zeroTrustEnabled = useFeatureFlagsStore((s) => s.zeroTrustEnabled);

  const tunnelSectionOpen = useUiPreferencesStore((s) => s.tunnelSectionOpen);
  const tunnelEventLogOpen = useUiPreferencesStore((s) => s.tunnelEventLogOpen);
  const tunnelDeployGuidesOpen = useUiPreferencesStore((s) => s.tunnelDeployGuidesOpen);
  const tunnelMetricsOpen = useUiPreferencesStore((s) => s.tunnelMetricsOpen);
  const setUiPref = useUiPreferencesStore((s) => s.set);

  const { copied: tokenCopied, copy: copyToken } = useCopyToClipboard();
  const { copied: cmdCopied, copy: copyCmd } = useCopyToClipboard();
  const { copied: composeCopied, copy: copyCompose } = useCopyToClipboard();
  const { copied: systemdCopied, copy: copySystemd } = useCopyToClipboard();

  const isEditMode = Boolean(gateway);
  const isTunnelEnabled = gateway?.tunnelEnabled ?? false;
  const isTunnelConnected = gateway?.tunnelConnected ?? false;
  const supportsGroupMode = type === 'MANAGED_SSH' || type === 'GUACD' || type === 'DB_PROXY';
  const isGroupMode = deploymentMode === 'MANAGED_GROUP';

  useEffect(() => {
    if (open && gateway) {
      setName(gateway.name); setType(gateway.type);
      setDeploymentMode(gateway.deploymentMode ?? (gateway.isManaged ? 'MANAGED_GROUP' : 'SINGLE_INSTANCE'));
      setHost(gateway.host); setPort(String(gateway.port));
      setDescription(gateway.description || ''); setIsDefault(gateway.isDefault);
      setUsername(''); setPassword(''); setSshPrivateKey('');
      setApiPort(gateway.apiPort ? String(gateway.apiPort) : '');
      setMonitoringEnabled(gateway.monitoringEnabled);
      setMonitorIntervalMs(String(gateway.monitorIntervalMs));
      setInactivityTimeout(String(Math.floor(gateway.inactivityTimeoutSeconds / 60)));
      setAutoScaleEnabled(gateway.autoScale); setMinReplicasVal(String(gateway.minReplicas));
      setMaxReplicasVal(String(gateway.maxReplicas)); setSessPerInstance(String(gateway.sessionsPerInstance));
      setCooldownVal(String(gateway.scaleDownCooldownSeconds));
      setPublishPorts(gateway.publishPorts ?? false); setLbStrategy(gateway.lbStrategy ?? 'ROUND_ROBIN');
    } else if (open) {
      setName(''); setType('GUACD'); setDeploymentMode('SINGLE_INSTANCE');
      setHost(''); setPort(''); setDescription(''); setIsDefault(false);
      setUsername(''); setPassword(''); setSshPrivateKey(''); setApiPort('');
      setMonitoringEnabled(true); setMonitorIntervalMs('5000'); setInactivityTimeout('60');
      setAutoScaleEnabled(false); setMinReplicasVal('0'); setMaxReplicasVal('5');
      setSessPerInstance('10'); setCooldownVal('300'); setPublishPorts(false); setLbStrategy('ROUND_ROBIN');
    }
    setError(''); setTunnelToken(null); setTunnelError(''); setTunnelDeploying(false);
    setRotateConfirmOpen(false); setRevokeConfirmOpen(false); setDisconnectConfirmOpen(false);
    setTunnelEvents([]); setTunnelMetrics(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gateway]);

  const handleTypeChange = (newType: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH' | 'DB_PROXY') => {
    setType(newType);
    const defaultPort = newType === 'GUACD' ? '4822' : newType === 'MANAGED_SSH' ? '2222' : newType === 'DB_PROXY' ? '5432' : '22';
    if (!port || port === '4822' || port === '22' || port === '2222' || port === '5432') setPort(defaultPort);
    if (newType === 'MANAGED_SSH' && !apiPort) setApiPort('9022');
    else if (newType !== 'MANAGED_SSH') setApiPort('');
    if (newType === 'SSH_BASTION') setDeploymentMode('SINGLE_INSTANCE');
  };

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('Gateway name is required'); return; }
    if (!isGroupMode && !host.trim()) { setError('Host is required'); return; }
    const portNum = parseInt(port, 10);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) { setError('Port must be between 1 and 65535'); return; }

    const ok = await run(async () => {
      if (isEditMode && gateway) {
        const data: Record<string, unknown> = {};
        const normalizedHost = isGroupMode ? '' : host.trim();
        const existingDeploymentMode = gateway.deploymentMode ?? (gateway.isManaged ? 'MANAGED_GROUP' : 'SINGLE_INSTANCE');
        if (name.trim() !== gateway.name) data.name = name.trim();
        if (deploymentMode !== existingDeploymentMode) data.deploymentMode = deploymentMode;
        if (normalizedHost !== gateway.host) data.host = normalizedHost;
        if (portNum !== gateway.port) data.port = portNum;
        if ((description.trim() || null) !== gateway.description) data.description = description.trim() || null;
        if (isDefault !== gateway.isDefault) data.isDefault = isDefault;
        if (gateway.type === 'MANAGED_SSH') {
          const newApiPort = apiPort ? parseInt(apiPort, 10) : null;
          if (newApiPort !== gateway.apiPort) data.apiPort = newApiPort;
        }
        if (type === 'SSH_BASTION') {
          if (username) data.username = username;
          if (password) data.password = password;
          if (sshPrivateKey) data.sshPrivateKey = sshPrivateKey;
        }
        if (supportsGroupMode && publishPorts !== (gateway.publishPorts ?? false)) data.publishPorts = publishPorts;
        if (supportsGroupMode && lbStrategy !== (gateway.lbStrategy ?? 'ROUND_ROBIN')) data.lbStrategy = lbStrategy;
        if (monitoringEnabled !== gateway.monitoringEnabled) data.monitoringEnabled = monitoringEnabled;
        const intervalNum = parseInt(monitorIntervalMs, 10);
        if (intervalNum && intervalNum !== gateway.monitorIntervalMs) data.monitorIntervalMs = intervalNum;
        const timeoutSec = parseInt(inactivityTimeout, 10) * 60;
        if (timeoutSec && timeoutSec !== gateway.inactivityTimeoutSeconds) data.inactivityTimeoutSeconds = timeoutSec;
        await updateGateway(gateway.id, data);
      } else {
        const apiPortNum = apiPort ? parseInt(apiPort, 10) : undefined;
        await createGateway({
          name: name.trim(), type, deploymentMode,
          host: isGroupMode ? '' : host.trim(), port: portNum,
          description: description.trim() || undefined, isDefault: isDefault || undefined,
          monitoringEnabled, monitorIntervalMs: parseInt(monitorIntervalMs, 10) || 5000,
          inactivityTimeoutSeconds: (parseInt(inactivityTimeout, 10) || 60) * 60,
          ...(type === 'SSH_BASTION' && username ? { username } : {}),
          ...(type === 'SSH_BASTION' && password ? { password } : {}),
          ...(type === 'SSH_BASTION' && sshPrivateKey ? { sshPrivateKey } : {}),
          ...(type === 'MANAGED_SSH' && apiPortNum ? { apiPort: apiPortNum } : {}),
          ...(supportsGroupMode && publishPorts ? { publishPorts } : {}),
          ...(supportsGroupMode ? { lbStrategy } : {}),
        });
      }
    }, isEditMode ? 'Failed to update gateway' : 'Failed to create gateway');
    if (ok) handleClose();
  };

  const handleEnableTunnel = async () => {
    if (!gateway) return;
    setTunnelError(''); setTunnelDeploying(true);
    const ok = await runTunnelAction(async () => {
      const result = await generateTunnelTokenAction(gateway.id);
      setTunnelToken(result.token);
    }, 'Failed to enable tunnel');
    setTunnelDeploying(false);
    if (!ok) setTunnelError('Failed to generate tunnel token');
  };

  const handleRotateTunnel = async () => {
    if (!gateway) return;
    setRotateConfirmOpen(false); setTunnelError('');
    const ok = await runTunnelAction(async () => {
      const result = await generateTunnelTokenAction(gateway.id);
      setTunnelToken(result.token);
    }, 'Failed to rotate tunnel token');
    if (!ok) setTunnelError('Failed to rotate tunnel token');
  };

  const handleRevokeTunnel = async () => {
    if (!gateway) return;
    setRevokeConfirmOpen(false); setTunnelError('');
    const ok = await runTunnelAction(async () => {
      await revokeTunnelTokenAction(gateway.id);
      setTunnelToken(null);
    }, 'Failed to revoke tunnel token');
    if (!ok) setTunnelError('Failed to revoke tunnel token');
  };

  const gatewayId = gateway?.id;

  const fetchTunnelEvents = useCallback(async () => {
    if (!gatewayId) return;
    setTunnelEventsLoading(true);
    try { const { events } = await getTunnelEventsApi(gatewayId); setTunnelEvents(events); }
    catch (err) { setTunnelError(extractApiError(err, 'Failed to load tunnel events')); }
    finally { setTunnelEventsLoading(false); }
  }, [gatewayId]);

  const fetchTunnelMetrics = useCallback(async () => {
    if (!gatewayId) return;
    setTunnelMetricsLoading(true);
    try { const metrics = await getTunnelMetricsApi(gatewayId); setTunnelMetrics(metrics); }
    catch { setTunnelMetrics(null); }
    finally { setTunnelMetricsLoading(false); }
  }, [gatewayId]);

  useEffect(() => {
    if (open && gatewayId && isTunnelEnabled) {
      fetchTunnelEvents();
      if (isTunnelConnected) fetchTunnelMetrics();
    }
  }, [open, gatewayId, isTunnelEnabled, isTunnelConnected, fetchTunnelEvents, fetchTunnelMetrics]);

  const handleForceDisconnect = useCallback(async () => {
    if (!gatewayId) return;
    setDisconnectConfirmOpen(false); setTunnelError('');
    const ok = await runTunnelAction(async () => { await forceDisconnectApi(gatewayId); }, 'Failed to disconnect tunnel');
    if (ok) await useGatewayStore.getState().fetchGateways();
  }, [gatewayId, runTunnelAction]);

  const serverUrl = window.location.origin;
  const dockerCommand = useMemo(() => {
    if (!tunnelToken) return '';
    return `docker run -d --restart=unless-stopped \\\n  -e TUNNEL_TOKEN="${tunnelToken}" \\\n  -e TUNNEL_SERVER_URL="${serverUrl}" \\\n  -e TUNNEL_GATEWAY_ID="${gatewayId ?? ''}" \\\n  arsenale/tunnel-agent:latest`;
  }, [tunnelToken, serverUrl, gatewayId]);

  const dockerCompose = useMemo(() => {
    if (!tunnelToken) return '';
    return `services:\n  arsenale-gateway:\n    image: arsenale/tunnel-agent:latest\n    restart: always\n    environment:\n      TUNNEL_SERVER_URL: "${serverUrl}"\n      TUNNEL_TOKEN: "${tunnelToken}"\n      TUNNEL_GATEWAY_ID: "${gatewayId ?? ''}"\n      TUNNEL_LOCAL_PORT: "4822"`;
  }, [tunnelToken, serverUrl, gatewayId]);

  const systemdUnit = useMemo(() => {
    if (!tunnelToken) return '';
    return `[Unit]\nDescription=Arsenale Tunnel Agent\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nRestart=always\nRestartSec=5\nEnvironment=TUNNEL_SERVER_URL=${serverUrl}\nEnvironment=TUNNEL_TOKEN=${tunnelToken}\nEnvironment=TUNNEL_GATEWAY_ID=${gatewayId ?? ''}\nEnvironment=TUNNEL_LOCAL_PORT=4822\nExecStart=/usr/local/bin/arsenale-tunnel-agent\n\n[Install]\nWantedBy=multi-user.target`;
  }, [tunnelToken, serverUrl, gatewayId]);

  const formatUptime = (connectedAt: string): string => {
    const diff = Date.now() - new Date(connectedAt).getTime();
    const hours = Math.floor(diff / 3600000); const minutes = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const certExpDisplay = (): string | null => {
    if (!gateway?.tunnelClientCertExp) return null;
    const exp = new Date(gateway.tunnelClientCertExp); const now = new Date();
    const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const expStr = exp.toLocaleDateString();
    if (diffDays <= 0) return `Expired on ${expStr}`;
    if (diffDays <= 7) return `Expires ${expStr} — renewal imminent`;
    return `Expires ${expStr} (next renewal in ${diffDays} days)`;
  };

  const handleClose = () => {
    setName(''); setType('GUACD'); setDeploymentMode('SINGLE_INSTANCE');
    setHost(''); setPort(''); setDescription(''); setIsDefault(false);
    setUsername(''); setPassword(''); setSshPrivateKey(''); setApiPort('');
    setMonitoringEnabled(true); setMonitorIntervalMs('5000'); setInactivityTimeout('60');
    setAutoScaleEnabled(false); setMinReplicasVal('0'); setMaxReplicasVal('5');
    setSessPerInstance('10'); setCooldownVal('300'); setPublishPorts(false); setLbStrategy('ROUND_ROBIN');
    setError(''); setTunnelToken(null); setTunnelError(''); setTunnelDeploying(false);
    setRotateConfirmOpen(false); setRevokeConfirmOpen(false); setDisconnectConfirmOpen(false);
    setTunnelEvents([]); setTunnelMetrics(null);
    onClose();
  };

  const certInfo = certExpDisplay();

  const renderTunnelStatusChip = () => {
    if (!isTunnelEnabled) return null;
    if (tunnelDeploying || tunnelActionLoading) {
      return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Deploying...</span>;
    }
    return isTunnelConnected
      ? <Badge className="bg-green-500/15 text-green-400 border-green-500/30">Connected</Badge>
      : <Badge className="bg-red-500/15 text-red-400 border-red-500/30">Disconnected</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="flex max-h-[min(88vh,calc(100vh-2rem))] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden sm:w-[90vw] sm:max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Gateway' : 'New Gateway'}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
          {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}
          <div className="space-y-4">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus maxLength={100} /></div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => handleTypeChange(v as typeof type)} disabled={isEditMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="GUACD">GUACD (RDP Gateway)</SelectItem>
                <SelectItem value="SSH_BASTION">SSH Bastion (Jump Host)</SelectItem>
                <SelectItem value="MANAGED_SSH">Managed SSH Gateway</SelectItem>
                <SelectItem value="DB_PROXY">DB Proxy (Database Gateway)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {supportsGroupMode && (
            <div className="space-y-1.5">
              <Label>Deployment Mode</Label>
              <Select value={deploymentMode} onValueChange={(v) => setDeploymentMode(v as GatewayDeploymentMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SINGLE_INSTANCE">Single Instance</SelectItem>
                  <SelectItem value="MANAGED_GROUP">Managed Group</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {!supportsGroupMode && <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">SSH bastions are always single-instance gateways.</div>}
          {type === 'MANAGED_SSH' && <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">This gateway uses the server&apos;s SSH key pair for authentication. No credentials needed.</div>}
          {type === 'DB_PROXY' && <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">Database proxy gateway. Credentials are injected per-session from the vault.</div>}
          {type === 'MANAGED_SSH' && (
            <div className="space-y-1.5"><Label>gRPC Port (key management)</Label><Input value={apiPort} onChange={(e) => setApiPort(e.target.value)} type="number" disabled={publishPorts} />{publishPorts ? <p className="text-xs text-muted-foreground">Auto-assigned at deploy</p> : <p className="text-xs text-muted-foreground">gRPC port for key management mTLS (default: 9022)</p>}</div>
          )}
          {supportsGroupMode && isGroupMode && (
            <div className="flex items-center gap-3"><Switch checked={publishPorts} onCheckedChange={(v) => { setPublishPorts(v); if (v) { const dp = type === 'GUACD' ? '4822' : type === 'DB_PROXY' ? '5432' : '2222'; setPort(dp); } }} /><Label>Publish Ports (external access)</Label></div>
          )}
          {publishPorts && supportsGroupMode && isGroupMode && <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-400">Each deployed instance will get a unique randomly-assigned host port for external access.</div>}
          {supportsGroupMode && isGroupMode && (
            <div className="space-y-1.5">
              <Label>Load Balancing Strategy</Label>
              <Select value={lbStrategy} onValueChange={(v) => setLbStrategy(v as 'ROUND_ROBIN' | 'LEAST_CONNECTIONS')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ROUND_ROBIN">Round Robin</SelectItem><SelectItem value="LEAST_CONNECTIONS">Least Connections</SelectItem></SelectContent>
              </Select>
            </div>
          )}
          {isGroupMode ? (
            <>
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-400">This gateway is a logical group. The port below is the service port used by deployed instances.</div>
              <div className="space-y-1.5"><Label>Service Port</Label><Input value={port} onChange={(e) => setPort(e.target.value)} type="number" />{publishPorts && <p className="text-xs text-muted-foreground">External host ports are assigned per instance at deploy time.</p>}</div>
            </>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5"><Label>Host</Label><Input value={host} onChange={(e) => setHost(e.target.value)} required readOnly={isTunnelEnabled && isEditMode} />{isTunnelEnabled && isEditMode && <p className="text-xs text-muted-foreground">Managed by tunnel</p>}</div>
              <div className="w-[120px] space-y-1.5"><Label>Port</Label><Input value={port} onChange={(e) => setPort(e.target.value)} type="number" disabled={isTunnelEnabled && isEditMode} /></div>
            </div>
          )}
          {type === 'SSH_BASTION' && (
            <>
              <div className="space-y-1.5"><Label>Username</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={isEditMode ? 'Leave blank to keep unchanged' : undefined} /></div>
              <div className="space-y-1.5"><Label>Password</Label><Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder={isEditMode ? 'Leave blank to keep unchanged' : undefined} /></div>
              <div className="space-y-1.5"><Label>SSH Private Key (PEM)</Label><Textarea value={sshPrivateKey} onChange={(e) => setSshPrivateKey(e.target.value)} rows={4} className="font-mono text-xs" placeholder={isEditMode ? (gateway?.hasSshKey ? 'Key configured — leave blank to keep unchanged' : 'Paste PEM-encoded private key') : 'Paste PEM-encoded private key (optional)'} /></div>
            </>
          )}
          <div className="space-y-1.5"><Label>Description (optional)</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} /></div>
          <div className="flex items-center gap-3"><Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} id="gw-default" /><Label htmlFor="gw-default">Set as default {type === 'GUACD' ? 'GUACD' : type === 'MANAGED_SSH' ? 'Managed SSH' : type === 'DB_PROXY' ? 'DB Proxy' : 'SSH Bastion'} gateway</Label></div>
          <div className="flex items-center gap-3"><Checkbox checked={monitoringEnabled} onCheckedChange={(v) => setMonitoringEnabled(v === true)} id="gw-monitor" /><Label htmlFor="gw-monitor">Enable health monitoring</Label></div>
          {monitoringEnabled && <div className="space-y-1.5"><Label>Monitor interval (ms)</Label><Input value={monitorIntervalMs} onChange={(e) => setMonitorIntervalMs(e.target.value)} type="number" /><p className="text-xs text-muted-foreground">How often to check connectivity (1000-3600000ms)</p></div>}
          <SessionTimeoutConfig value={inactivityTimeout} onChange={setInactivityTimeout} />

          {/* Auto-Scaling */}
          {isEditMode && isGroupMode && supportsGroupMode && (
            <Accordion type="single" collapsible>
              <AccordionItem value="scaling">
                <AccordionTrigger><span className="text-sm font-medium">Auto-Scaling Configuration</span></AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3"><Switch checked={autoScaleEnabled} onCheckedChange={setAutoScaleEnabled} /><Label>Enable Auto-Scale</Label></div>
                    {autoScaleEnabled && (
                      <div className="flex flex-wrap gap-3">
                        <div className="w-[120px] space-y-1"><Label className="text-xs">Min Replicas</Label><Input value={minReplicasVal} onChange={(e) => setMinReplicasVal(e.target.value)} type="number" className="h-8" /></div>
                        <div className="w-[120px] space-y-1"><Label className="text-xs">Max Replicas</Label><Input value={maxReplicasVal} onChange={(e) => setMaxReplicasVal(e.target.value)} type="number" className="h-8" /></div>
                        <div className="w-[150px] space-y-1"><Label className="text-xs">Sessions/Instance</Label><Input value={sessPerInstance} onChange={(e) => setSessPerInstance(e.target.value)} type="number" className="h-8" /></div>
                        <div className="w-[120px] space-y-1"><Label className="text-xs">Cooldown (s)</Label><Input value={cooldownVal} onChange={(e) => setCooldownVal(e.target.value)} type="number" className="h-8" /></div>
                      </div>
                    )}
                    <Button variant="outline" size="sm" disabled={scalingSaving} onClick={() => runScaling(async () => { await updateScalingConfig(gateway?.id ?? '', { autoScale: autoScaleEnabled, minReplicas: Number(minReplicasVal), maxReplicas: Number(maxReplicasVal), sessionsPerInstance: Number(sessPerInstance), scaleDownCooldownSeconds: Number(cooldownVal) }); }, 'Failed to save scaling config')}>
                      <Save className="h-4 w-4 mr-1" />{scalingSaving ? 'Saving...' : 'Save Scaling Config'}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          {/* Zero-Trust Tunnel */}
          {gateway && zeroTrustEnabled && (
            <Accordion type="single" collapsible value={tunnelSectionOpen ? 'tunnel' : ''} onValueChange={(v) => setUiPref('tunnelSectionOpen', v === 'tunnel')}>
              <AccordionItem value="tunnel">
                <AccordionTrigger>
                  <div className="flex items-center gap-2 w-full">
                    <Lock className={`h-4 w-4 ${isTunnelEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-sm font-medium flex-1">Zero-Trust Tunnel</span>
                    {renderTunnelStatusChip()}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    {tunnelError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400 flex justify-between"><span>{tunnelError}</span><button onClick={() => setTunnelError('')} className="text-xs">dismiss</button></div>}

                    <GatewayEgressPolicyEditor
                      gatewayId={gateway.id}
                      policy={gateway.egressPolicy}
                    />

                    <Separator />

                    {!isTunnelEnabled ? (
                      <>
                        <p className="text-sm text-muted-foreground">Enable a zero-trust tunnel so the gateway agent connects outbound to this server. No inbound ports required.</p>
                        <Button variant="outline" size="sm" disabled={tunnelDeploying || tunnelActionLoading} onClick={handleEnableTunnel}>
                          {tunnelDeploying || tunnelActionLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Lock className="h-4 w-4 mr-1" />}
                          {tunnelDeploying || tunnelActionLoading ? 'Enabling...' : 'Enable Zero-Trust Tunnel'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">Status:</span>
                          {renderTunnelStatusChip()}
                          {gateway?.tunnelConnectedAt && isTunnelConnected && <span className="text-xs text-muted-foreground">since {new Date(gateway.tunnelConnectedAt).toLocaleString()}</span>}
                        </div>
                        {certInfo && <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-400">{certInfo}</div>}
                        <Separator />

                        {isGroupMode && tunnelToken && (
                          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400 space-y-2">
                            Token generated — copy it now, it will not be shown again.
                            <Input value={tunnelToken} readOnly className="font-mono text-xs" />
                            <Button size="sm" onClick={() => copyToken(tunnelToken)}><Copy className="h-3.5 w-3.5 mr-1" />{tokenCopied ? 'Copied!' : 'Copy Token'}</Button>
                          </div>
                        )}

                        {!isGroupMode && (
                          <>
                            <p className="text-sm text-muted-foreground">Run the following Docker command on the gateway machine:</p>
                            {tunnelToken ? (
                              <>
                                <Textarea value={dockerCommand} readOnly rows={3} className="font-mono text-xs" />
                                <Button size="sm" onClick={() => copyCmd(dockerCommand)}><Copy className="h-3.5 w-3.5 mr-1" />{cmdCopied ? 'Copied!' : 'Copy Docker Command'}</Button>
                                <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 text-sm text-yellow-400">Copy this command now — the token will not be shown again after closing.</div>
                              </>
                            ) : (
                              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm text-blue-400">Tunnel is enabled. Rotate the token to get a new docker run command.</div>
                            )}
                          </>
                        )}

                        {/* Token management */}
                        <div className="flex gap-2 flex-wrap">
                          {isTunnelConnected && (
                            !disconnectConfirmOpen ? (
                              <Button size="sm" variant="outline" className="text-red-400 border-red-500/30" disabled={tunnelActionLoading} onClick={() => setDisconnectConfirmOpen(true)}><Power className="h-3.5 w-3.5 mr-1" />Force Disconnect</Button>
                            ) : (
                              <>
                                <p className="text-xs text-red-400 self-center">This will forcefully disconnect the tunnel agent.</p>
                                <Button size="sm" variant="destructive" onClick={handleForceDisconnect} disabled={tunnelActionLoading}>Yes, Disconnect</Button>
                                <Button size="sm" variant="outline" onClick={() => setDisconnectConfirmOpen(false)}>Cancel</Button>
                              </>
                            )
                          )}
                          {!rotateConfirmOpen ? (
                            <Button size="sm" variant="outline" className="text-yellow-400 border-yellow-500/30" disabled={tunnelActionLoading} onClick={() => setRotateConfirmOpen(true)}><RefreshCw className="h-3.5 w-3.5 mr-1" />Rotate Token</Button>
                          ) : (
                            <><p className="text-xs text-yellow-400 self-center">Confirm rotate?</p><Button size="sm" className="bg-yellow-600 hover:bg-yellow-700" onClick={handleRotateTunnel} disabled={tunnelActionLoading}>Yes, Rotate</Button><Button size="sm" variant="outline" onClick={() => setRotateConfirmOpen(false)}>Cancel</Button></>
                          )}
                          {!revokeConfirmOpen ? (
                            <Button size="sm" variant="outline" className="text-red-400 border-red-500/30" disabled={tunnelActionLoading} onClick={() => setRevokeConfirmOpen(true)}><Trash2 className="h-3.5 w-3.5 mr-1" />Revoke Token</Button>
                          ) : (
                            <><p className="text-xs text-red-400 self-center">Confirm revoke?</p><Button size="sm" variant="destructive" onClick={handleRevokeTunnel} disabled={tunnelActionLoading}>Yes, Revoke</Button><Button size="sm" variant="outline" onClick={() => setRevokeConfirmOpen(false)}>Cancel</Button></>
                          )}
                        </div>

                        {/* Live Metrics */}
                        {isTunnelConnected && (
                          <Accordion type="single" collapsible value={tunnelMetricsOpen ? 'metrics' : ''} onValueChange={(v) => setUiPref('tunnelMetricsOpen', v === 'metrics')}>
                            <AccordionItem value="metrics">
                              <AccordionTrigger><div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" /><span className="text-sm font-medium">Live Metrics</span></div></AccordionTrigger>
                              <AccordionContent>
                                {tunnelMetricsLoading ? <div className="flex justify-center py-2"><Loader2 className="h-5 w-5 animate-spin" /></div>
                                : tunnelMetrics?.connectedAt ? (
                                  <div className="flex gap-1.5 flex-wrap">
                                    <Badge variant="outline">Uptime: {formatUptime(tunnelMetrics.connectedAt)}</Badge>
                                    <Badge variant="outline" className={tunnelMetrics.pingPongLatency != null && tunnelMetrics.pingPongLatency < 100 ? 'border-green-500/30 text-green-400' : ''}>RTT: {tunnelMetrics.pingPongLatency != null ? `${tunnelMetrics.pingPongLatency}ms` : 'N/A'}</Badge>
                                    <Badge variant="outline">Streams: {tunnelMetrics.activeStreams ?? 0}</Badge>
                                    <Badge variant="outline">Agent: {tunnelMetrics.clientVersion ?? 'unknown'}</Badge>
                                  </div>
                                ) : <p className="text-xs text-muted-foreground">No metrics available</p>}
                                <Button size="sm" variant="ghost" onClick={fetchTunnelMetrics} className="mt-2">Refresh</Button>
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        )}

                        {/* Event Log */}
                        <Accordion type="single" collapsible value={tunnelEventLogOpen ? 'events' : ''} onValueChange={(v) => setUiPref('tunnelEventLogOpen', v === 'events')}>
                          <AccordionItem value="events">
                            <AccordionTrigger><div className="flex items-center gap-2"><History className="h-4 w-4" /><span className="text-sm font-medium">Connection Event Log</span></div></AccordionTrigger>
                            <AccordionContent>
                              {tunnelEventsLoading ? <div className="flex justify-center py-2"><Loader2 className="h-5 w-5 animate-spin" /></div>
                              : tunnelEvents.length === 0 ? <p className="text-xs text-muted-foreground">No tunnel events recorded yet.</p>
                              : (
                                <div className="max-h-[200px] overflow-auto space-y-1">
                                  {tunnelEvents.map((evt, idx) => (
                                    <div key={idx} className="flex items-center gap-2 py-0.5">
                                      <Badge className={evt.action === 'TUNNEL_CONNECT' ? 'bg-green-500/15 text-green-400 border-green-500/30 min-w-[85px] justify-center' : 'bg-red-500/15 text-red-400 border-red-500/30 min-w-[85px] justify-center'}>
                                        {evt.action === 'TUNNEL_CONNECT' ? 'Connect' : 'Disconnect'}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(evt.timestamp).toLocaleString()}</span>
                                      {evt.ipAddress && <span className="text-xs text-muted-foreground">{evt.ipAddress}</span>}
                                      {evt.details && typeof evt.details === 'object' && 'clientVersion' in evt.details && <span className="text-xs text-muted-foreground">v{String(evt.details.clientVersion)}</span>}
                                      {evt.details && typeof evt.details === 'object' && 'forced' in evt.details && <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">Forced</Badge>}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <Button size="sm" variant="ghost" onClick={fetchTunnelEvents} className="mt-2">Refresh</Button>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>

                        {/* Deploy Guides */}
                        {!isGroupMode && tunnelToken && (
                          <Accordion type="single" collapsible value={tunnelDeployGuidesOpen ? 'guides' : ''} onValueChange={(v) => setUiPref('tunnelDeployGuidesOpen', v === 'guides')}>
                            <AccordionItem value="guides">
                              <AccordionTrigger><div className="flex items-center gap-2"><Rocket className="h-4 w-4" /><span className="text-sm font-medium">Deployment Guides</span></div></AccordionTrigger>
                              <AccordionContent>
                                <div className="space-y-4">
                                  <div><p className="text-xs font-medium mb-1">Docker Compose</p><Textarea value={dockerCompose} readOnly rows={3} className="font-mono text-[0.7rem]" /><Button size="sm" variant="ghost" onClick={() => copyCompose(dockerCompose)} className="mt-1"><Copy className="h-3.5 w-3.5 mr-1" />{composeCopied ? 'Copied!' : 'Copy'}</Button></div>
                                  <div><p className="text-xs font-medium mb-1">Systemd Unit</p><Textarea value={systemdUnit} readOnly rows={3} className="font-mono text-[0.7rem]" /><Button size="sm" variant="ghost" onClick={() => copySystemd(systemdUnit)} className="mt-1"><Copy className="h-3.5 w-3.5 mr-1" />{systemdCopied ? 'Copied!' : 'Copy'}</Button></div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        )}
                      </>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (isEditMode ? 'Saving...' : 'Creating...') : (isEditMode ? 'Save' : 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
