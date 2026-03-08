import api from './client';

export type GatewayHealthStatus = 'UNKNOWN' | 'REACHABLE' | 'UNREACHABLE';

export interface GatewayData {
  id: string;
  name: string;
  type: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH';
  host: string;
  port: number;
  description: string | null;
  isDefault: boolean;
  hasSshKey: boolean;
  apiPort: number | null;
  inactivityTimeoutSeconds: number;
  tenantId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  monitoringEnabled: boolean;
  monitorIntervalMs: number;
  lastHealthStatus: GatewayHealthStatus;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  isManaged: boolean;
  publishPorts: boolean;
  lbStrategy: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
  desiredReplicas: number;
  autoScale: boolean;
  minReplicas: number;
  maxReplicas: number;
  sessionsPerInstance: number;
  scaleDownCooldownSeconds: number;
  lastScaleAction: string | null;
  templateId: string | null;
  totalInstances: number;
  runningInstances: number;
}

export interface GatewayInput {
  name: string;
  type: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH';
  host: string;
  port: number;
  description?: string;
  isDefault?: boolean;
  username?: string;
  password?: string;
  sshPrivateKey?: string;
  apiPort?: number;
  publishPorts?: boolean;
  lbStrategy?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
  monitoringEnabled?: boolean;
  monitorIntervalMs?: number;
  inactivityTimeoutSeconds?: number;
}

export interface GatewayUpdate {
  name?: string;
  host?: string;
  port?: number;
  description?: string | null;
  isDefault?: boolean;
  username?: string;
  password?: string;
  sshPrivateKey?: string;
  apiPort?: number | null;
  publishPorts?: boolean;
  lbStrategy?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
  monitoringEnabled?: boolean;
  monitorIntervalMs?: number;
  inactivityTimeoutSeconds?: number;
}

export interface TestResult {
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface GatewayHealthEvent {
  gatewayId: string;
  status: GatewayHealthStatus;
  latencyMs: number | null;
  error: string | null;
  checkedAt: string;
}

export interface SshKeyPairData {
  id: string;
  publicKey: string;
  fingerprint: string;
  algorithm: string;
  createdAt: string;
  updatedAt: string;
}

export async function listGateways(): Promise<GatewayData[]> {
  const res = await api.get('/gateways');
  return res.data;
}

export async function createGateway(data: GatewayInput): Promise<GatewayData> {
  const res = await api.post('/gateways', data);
  return res.data;
}

export async function updateGateway(id: string, data: GatewayUpdate): Promise<GatewayData> {
  const res = await api.put(`/gateways/${id}`, data);
  return res.data;
}

export async function deleteGateway(id: string, force?: boolean): Promise<{ deleted: boolean }> {
  const res = await api.delete(`/gateways/${id}`, { params: force ? { force: 'true' } : undefined });
  return res.data;
}

export async function testGateway(id: string): Promise<TestResult> {
  const res = await api.post(`/gateways/${id}/test`);
  return res.data;
}

export async function getSshKeyPair(): Promise<SshKeyPairData> {
  const res = await api.get('/gateways/ssh-keypair');
  return res.data;
}

export async function generateSshKeyPair(): Promise<SshKeyPairData> {
  const res = await api.post('/gateways/ssh-keypair');
  return res.data;
}

export interface KeyPushResult {
  gatewayId: string;
  name: string;
  ok: boolean;
  error?: string;
}

export interface RotateKeyPairResponse extends SshKeyPairData {
  pushResults?: KeyPushResult[];
}

export async function rotateSshKeyPair(): Promise<RotateKeyPairResponse> {
  const res = await api.post('/gateways/ssh-keypair/rotate');
  return res.data;
}

export async function pushKeyToGateway(id: string): Promise<{ ok: boolean; error?: string }> {
  const res = await api.post(`/gateways/${id}/push-key`);
  return res.data;
}

export async function downloadSshPrivateKey(): Promise<string> {
  const res = await api.get('/gateways/ssh-keypair/private', { responseType: 'text' });
  return res.data;
}

// ---------- Session Monitoring ----------

export interface ActiveSessionData {
  id: string;
  userId: string;
  username: string | null;
  email: string;
  connectionId: string;
  connectionName: string;
  connectionHost: string;
  connectionPort: number;
  gatewayId: string | null;
  gatewayName: string | null;
  instanceId: string | null;
  instanceName: string | null;
  protocol: 'SSH' | 'RDP';
  status: 'ACTIVE' | 'IDLE' | 'CLOSED';
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  durationFormatted: string;
}

export async function listActiveSessions(params?: {
  protocol?: 'SSH' | 'RDP';
  gatewayId?: string;
}): Promise<ActiveSessionData[]> {
  const res = await api.get('/sessions/active', { params });
  return res.data;
}

export async function getSessionCount(): Promise<{ count: number }> {
  const res = await api.get('/sessions/count');
  return res.data;
}

export async function getSessionCountByGateway(): Promise<
  Array<{ gatewayId: string; gatewayName: string; count: number }>
> {
  const res = await api.get('/sessions/count/gateway');
  return res.data;
}

export async function terminateSession(sessionId: string): Promise<{ ok: boolean }> {
  const res = await api.post(`/sessions/${sessionId}/terminate`);
  return res.data;
}

// ---------- Managed Gateway Lifecycle ----------

export interface ManagedInstanceData {
  id: string;
  gatewayId: string;
  containerId: string;
  containerName: string;
  host: string;
  port: number;
  status: 'PROVISIONING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'REMOVING';
  orchestratorType: string;
  healthStatus: string | null;
  lastHealthCheck: string | null;
  errorMessage: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export async function deployGateway(id: string): Promise<{
  instanceId: string; containerId: string; host: string; port: number;
}> {
  const res = await api.post(`/gateways/${id}/deploy`);
  return res.data;
}

export async function undeployGateway(id: string): Promise<{ undeployed: boolean }> {
  const res = await api.delete(`/gateways/${id}/deploy`);
  return res.data;
}

export async function scaleGateway(id: string, replicas: number): Promise<{
  deployed: number; removed: number;
}> {
  const res = await api.post(`/gateways/${id}/scale`, { replicas });
  return res.data;
}

export async function listGatewayInstances(id: string): Promise<ManagedInstanceData[]> {
  const res = await api.get(`/gateways/${id}/instances`);
  return res.data;
}

export async function restartGatewayInstance(
  gatewayId: string,
  instanceId: string,
): Promise<{ restarted: boolean }> {
  const res = await api.post(`/gateways/${gatewayId}/instances/${instanceId}/restart`);
  return res.data;
}

export interface ContainerLogsData {
  logs: string;
  containerId: string;
  containerName: string;
  timestamp: string;
}

export async function getInstanceLogs(
  gatewayId: string,
  instanceId: string,
  tail?: number,
): Promise<ContainerLogsData> {
  const res = await api.get(`/gateways/${gatewayId}/instances/${instanceId}/logs`, {
    params: tail != null ? { tail } : undefined,
  });
  return res.data;
}

// ---------- Auto-Scaling Configuration ----------

export interface ScalingStatusData {
  gatewayId: string;
  autoScale: boolean;
  minReplicas: number;
  maxReplicas: number;
  sessionsPerInstance: number;
  scaleDownCooldownSeconds: number;
  currentReplicas: number;
  activeSessions: number;
  targetReplicas: number;
  lastScaleAction: string | null;
  cooldownRemaining: number;
  recommendation: 'scale-up' | 'scale-down' | 'stable';
  instanceSessions: Array<{ instanceId: string; containerName: string; count: number }>;
}

export interface ScalingConfigInput {
  autoScale?: boolean;
  minReplicas?: number;
  maxReplicas?: number;
  sessionsPerInstance?: number;
  scaleDownCooldownSeconds?: number;
}

export async function getScalingStatus(id: string): Promise<ScalingStatusData> {
  const res = await api.get(`/gateways/${id}/scaling`);
  return res.data;
}

export async function updateScalingConfig(
  id: string,
  config: ScalingConfigInput,
): Promise<ScalingConfigInput & { id: string; lastScaleAction: string | null }> {
  const res = await api.put(`/gateways/${id}/scaling`, config);
  return res.data;
}

// ---------- Gateway Templates ----------

export interface GatewayTemplateData {
  id: string;
  name: string;
  type: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH';
  host: string;
  port: number;
  description: string | null;
  apiPort: number | null;
  autoScale: boolean;
  minReplicas: number;
  maxReplicas: number;
  sessionsPerInstance: number;
  scaleDownCooldownSeconds: number;
  monitoringEnabled: boolean;
  monitorIntervalMs: number;
  inactivityTimeoutSeconds: number;
  publishPorts: boolean;
  lbStrategy: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
  tenantId: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  _count: { gateways: number };
}

export interface GatewayTemplateInput {
  name: string;
  type: 'GUACD' | 'SSH_BASTION' | 'MANAGED_SSH';
  host?: string;
  port?: number;
  description?: string;
  apiPort?: number;
  autoScale?: boolean;
  minReplicas?: number;
  maxReplicas?: number;
  sessionsPerInstance?: number;
  scaleDownCooldownSeconds?: number;
  publishPorts?: boolean;
  lbStrategy?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS';
  monitoringEnabled?: boolean;
  monitorIntervalMs?: number;
  inactivityTimeoutSeconds?: number;
}

export type GatewayTemplateUpdate = Partial<GatewayTemplateInput>;

export async function listGatewayTemplates(): Promise<GatewayTemplateData[]> {
  const res = await api.get('/gateways/templates');
  return res.data;
}

export async function createGatewayTemplate(data: GatewayTemplateInput): Promise<GatewayTemplateData> {
  const res = await api.post('/gateways/templates', data);
  return res.data;
}

export async function updateGatewayTemplate(id: string, data: GatewayTemplateUpdate): Promise<GatewayTemplateData> {
  const res = await api.put(`/gateways/templates/${id}`, data);
  return res.data;
}

export async function deleteGatewayTemplate(id: string): Promise<{ deleted: boolean }> {
  const res = await api.delete(`/gateways/templates/${id}`);
  return res.data;
}

export async function deployFromTemplate(templateId: string): Promise<GatewayData> {
  const res = await api.post(`/gateways/templates/${templateId}/deploy`);
  return res.data;
}
