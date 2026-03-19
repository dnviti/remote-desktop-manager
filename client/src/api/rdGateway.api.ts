import api from './client';

export interface RdGatewayConfig {
  enabled: boolean;
  externalHostname: string;
  port: number;
  idleTimeoutSeconds: number;
}

export interface RdGatewayStatus {
  activeTunnels: number;
  activeChannels: number;
}

/** Get current RD Gateway configuration (admin only). */
export async function getRdGatewayConfig(): Promise<RdGatewayConfig> {
  const { data } = await api.get<RdGatewayConfig>('/rdgw/config');
  return data;
}

/** Update RD Gateway configuration (admin only). */
export async function updateRdGatewayConfig(config: Partial<RdGatewayConfig>): Promise<RdGatewayConfig> {
  const { data } = await api.put<RdGatewayConfig>('/rdgw/config', config);
  return data;
}

/** Get RD Gateway status (admin/operator). */
export async function getRdGatewayStatus(): Promise<RdGatewayStatus> {
  const { data } = await api.get<RdGatewayStatus>('/rdgw/status');
  return data;
}

/**
 * Download a .rdp file for a connection, pre-configured with gateway settings.
 * Opens a download dialog in the browser.
 */
export async function downloadRdpFile(connectionId: string, connectionName: string): Promise<void> {
  const { data } = await api.get<string>(`/rdgw/connections/${connectionId}/rdpfile`, {
    responseType: 'text',
  });

  // Create a download link
  const blob = new Blob([data], { type: 'application/x-rdp' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeFilename = connectionName.replace(/[^a-zA-Z0-9._-]/g, '_');
  link.download = `${safeFilename}.rdp`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
