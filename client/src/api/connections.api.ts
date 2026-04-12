import api from './client';
import type { SshTerminalConfig } from '../constants/terminalThemes';
import type { RdpSettings } from '../constants/rdpDefaults';
import type { VncSettings } from '../constants/vncDefaults';
import type {
  DbQueryType,
  FirewallAction,
  FirewallRuleInput,
  MaskingPolicyInput,
  MaskingStrategy,
  RateLimitAction,
  RateLimitPolicyInput,
} from './dbAudit.api';

export interface DlpPolicy {
  disableCopy?: boolean;
  disablePaste?: boolean;
  disableDownload?: boolean;
  disableUpload?: boolean;
}

export interface ResolvedDlpPolicy {
  disableCopy: boolean;
  disablePaste: boolean;
  disableDownload: boolean;
  disableUpload: boolean;
}

export type DbProtocol = 'postgresql' | 'mysql' | 'mongodb' | 'oracle' | 'mssql' | 'db2';
export type DbCloudProvider = 'azure' | 'aws' | 'gcp';
export type OracleConnectionType = 'basic' | 'tns' | 'custom';
export type OracleRole = 'normal' | 'sysdba' | 'sysoper' | 'sysasm' | 'sysbackup' | 'sysdg' | 'syskm' | 'sysrac';
export type DbPolicyOverrideMode = 'inherit' | 'merge' | 'override';

export interface ConnectionFirewallRule extends FirewallRuleInput {
  id?: string;
  action: FirewallAction;
}

export interface ConnectionMaskingPolicy extends MaskingPolicyInput {
  id?: string;
  strategy: MaskingStrategy;
  exemptRoles?: string[];
}

export interface ConnectionRateLimitPolicy extends RateLimitPolicyInput {
  id?: string;
  queryType?: DbQueryType | null;
  action?: RateLimitAction;
  exemptRoles?: string[];
}

export interface DbSettings {
  protocol: DbProtocol;
  databaseName?: string;
  /** Cloud-managed provider preset used to recommend TLS defaults for MySQL/PostgreSQL. */
  cloudProvider?: DbCloudProvider;
  /** Connection security mode. Values are interpreted per driver/protocol by the backend. */
  sslMode?: string;
  /** Persist execution plans in DB audit logs for supported SQL protocols. */
  persistExecutionPlan?: boolean;
  /** Enable SQL firewall enforcement for this connection. */
  firewallEnabled?: boolean;
  /** Control how connection firewall rules interact with tenant-wide firewall rules. */
  firewallPolicyMode?: DbPolicyOverrideMode;
  /** Connection-specific firewall rules. */
  firewallRules?: ConnectionFirewallRule[];
  /** Enable masking enforcement for this connection. */
  maskingEnabled?: boolean;
  /** Control how connection masking policies interact with tenant-wide masking policies. */
  maskingPolicyMode?: DbPolicyOverrideMode;
  /** Connection-specific masking policies. */
  maskingPolicies?: ConnectionMaskingPolicy[];
  /** Enable rate limiting for this connection. */
  rateLimitEnabled?: boolean;
  /** Control how connection rate limits interact with tenant-wide rate limits. */
  rateLimitPolicyMode?: DbPolicyOverrideMode;
  /** Connection-specific rate limit policies. */
  rateLimitPolicies?: ConnectionRateLimitPolicy[];
  /** Enable AI query generation for this connection. */
  aiQueryGenerationEnabled?: boolean;
  /** Preferred AI backend for query generation. */
  aiQueryGenerationBackend?: string;
  /** Preferred model override for query generation. */
  aiQueryGenerationModel?: string;
  /** Enable AI query optimization for this connection. */
  aiQueryOptimizerEnabled?: boolean;
  /** Preferred AI backend for query optimization. */
  aiQueryOptimizerBackend?: string;
  /** Preferred model override for query optimization. */
  aiQueryOptimizerModel?: string;
  /** Oracle: connection mode (defaults to 'basic' for backward compat). */
  oracleConnectionType?: OracleConnectionType;
  /** Oracle Basic: SID for the target instance (mutually exclusive with serviceName). */
  oracleSid?: string;
  /** Oracle Basic: Service name for the target instance. */
  oracleServiceName?: string;
  /** Oracle: privilege role for the connection. */
  oracleRole?: OracleRole;
  /** Oracle TNS: alias name resolved via TNS_ADMIN / tnsnames.ora. */
  oracleTnsAlias?: string;
  /** Oracle TNS: full TNS descriptor string. */
  oracleTnsDescriptor?: string;
  /** Oracle Custom: raw connect string passed directly to the driver. */
  oracleConnectString?: string;
  /** MSSQL: Named instance (e.g. "SQLEXPRESS"). */
  mssqlInstanceName?: string;
  /** MSSQL: Authentication mode — "sql" for SQL auth, "windows" for NTLM/Kerberos. */
  mssqlAuthMode?: 'sql' | 'windows';
  /** DB2: Database alias as cataloged on the DB2 Connect gateway. */
  db2DatabaseAlias?: string;
}

export interface ConnectionInput {
  name: string;
  type: 'RDP' | 'SSH' | 'VNC' | 'DATABASE' | 'DB_TUNNEL';
  host: string;
  port: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string;
  externalVaultProviderId?: string | null;
  externalVaultPath?: string | null;
  description?: string;
  folderId?: string;
  teamId?: string;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig>;
  rdpSettings?: Partial<RdpSettings>;
  vncSettings?: Partial<VncSettings>;
  dbSettings?: DbSettings;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
  dlpPolicy?: DlpPolicy | null;
  // DB_TUNNEL-specific fields
  targetDbHost?: string;
  targetDbPort?: number;
  dbType?: string;
}

export interface ConnectionData {
  id: string;
  name: string;
  type: 'RDP' | 'SSH' | 'VNC' | 'DATABASE' | 'DB_TUNNEL';
  host: string;
  port: number;
  folderId: string | null;
  teamId?: string | null;
  teamName?: string | null;
  teamRole?: string | null;
  scope?: 'private' | 'team' | 'shared';
  credentialSecretId?: string | null;
  credentialSecretName?: string | null;
  credentialSecretType?: string | null;
  externalVaultProviderId?: string | null;
  externalVaultPath?: string | null;
  description: string | null;
  isFavorite: boolean;
  enableDrive: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
  rdpSettings?: Partial<RdpSettings> | null;
  vncSettings?: Partial<VncSettings> | null;
  dbSettings?: DbSettings | null;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
  dlpPolicy?: DlpPolicy | null;
  // DB_TUNNEL-specific fields
  targetDbHost?: string | null;
  targetDbPort?: number | null;
  dbType?: string | null;
  bastionConnectionId?: string | null;
  isOwner: boolean;
  permission?: string;
  sharedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionsResponse {
  own: ConnectionData[];
  shared: ConnectionData[];
  team: ConnectionData[];
}

export async function listConnections(): Promise<ConnectionsResponse> {
  const { data } = await api.get('/connections');
  return data;
}

export async function createConnection(payload: ConnectionInput): Promise<ConnectionData> {
  const { data } = await api.post('/connections', payload);
  return data;
}

export interface ConnectionUpdate {
  name?: string;
  type?: 'RDP' | 'SSH' | 'VNC' | 'DATABASE' | 'DB_TUNNEL';
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  credentialSecretId?: string | null;
  externalVaultProviderId?: string | null;
  externalVaultPath?: string | null;
  description?: string | null;
  folderId?: string | null;
  enableDrive?: boolean;
  gatewayId?: string | null;
  sshTerminalConfig?: Partial<SshTerminalConfig> | null;
  rdpSettings?: Partial<RdpSettings> | null;
  vncSettings?: Partial<VncSettings> | null;
  dbSettings?: DbSettings | null;
  defaultCredentialMode?: 'saved' | 'domain' | 'prompt' | null;
  dlpPolicy?: DlpPolicy | null;
  // DB_TUNNEL-specific fields
  targetDbHost?: string | null;
  targetDbPort?: number | null;
  dbType?: string | null;
}

export async function updateConnection(
  id: string,
  payload: ConnectionUpdate
): Promise<ConnectionData> {
  const { data } = await api.put(`/connections/${id}`, payload);
  return data;
}

export async function deleteConnection(id: string) {
  const { data } = await api.delete(`/connections/${id}`);
  return data;
}

export async function getConnection(id: string): Promise<ConnectionData> {
  const { data } = await api.get(`/connections/${id}`);
  return data;
}

export async function toggleFavorite(id: string): Promise<{ id: string; isFavorite: boolean }> {
  const { data } = await api.patch(`/connections/${id}/favorite`);
  return data;
}
