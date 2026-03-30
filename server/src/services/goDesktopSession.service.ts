import { config } from '../config';
import { AppError } from '../middleware/error.middleware';

type DesktopProtocol = 'RDP' | 'VNC';

export interface DesktopRoutingDecision {
  strategy: string;
  candidateCount: number;
  selectedSessionCount: number;
}

export interface DesktopSessionGrantIssueRequest {
  userId: string;
  connectionId: string;
  gatewayId?: string;
  instanceId?: string;
  protocol: DesktopProtocol;
  ipAddress?: string;
  sessionMetadata?: Record<string, unknown>;
  routingDecision?: DesktopRoutingDecision;
  recordingId?: string;
  token: {
    guacdHost?: string;
    guacdPort?: number;
    settings: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

export interface DesktopSessionGrantIssueResponse {
  token: string;
  sessionId: string;
  recordingId?: string;
}

function resolveUrl(): string {
  return config.goControlPlaneApiUrl.replace(/\/+$/, '');
}

async function readError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await response.json() as { error?: string };
    if (body?.error) {
      message = body.error;
    }
  } catch {
    // ignore malformed error body
  }
  throw new AppError(message, response.status >= 500 ? 502 : response.status);
}

export async function issueDesktopSessionGrant(
  request: DesktopSessionGrantIssueRequest,
): Promise<DesktopSessionGrantIssueResponse> {
  const response = await fetch(`${resolveUrl()}/v1/desktop/session-grants:issue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    await readError(response, `Go control plane returned status ${response.status}`);
  }

  return await response.json() as DesktopSessionGrantIssueResponse;
}

export async function heartbeatDesktopSession(sessionId: string, userId: string): Promise<void> {
  const response = await fetch(`${resolveUrl()}/v1/desktop/sessions/${encodeURIComponent(sessionId)}/heartbeat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId }),
  });

  if (!response.ok) {
    await readError(response, `Go control plane returned status ${response.status}`);
  }
}

export async function endDesktopSession(sessionId: string, userId: string, reason = 'client_disconnect'): Promise<void> {
  const response = await fetch(`${resolveUrl()}/v1/desktop/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, reason }),
  });

  if (!response.ok) {
    await readError(response, `Go control plane returned status ${response.status}`);
  }
}
