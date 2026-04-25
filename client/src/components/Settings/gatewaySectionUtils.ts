import type { GatewayData, TestResult } from "../../api/gateway.api";
import type { TunnelStatusEvent } from "../../store/gatewayStore";
import { downloadTextFile } from "../../utils/downloadFile";
import { gatewayStatusTone } from "../../utils/gatewayStatus";
import { gatewayModeLabel, isGatewayGroup } from "../../utils/gatewayMode";

export interface GatewayTestState {
  gatewayId: string;
  loading: boolean;
  result?: TestResult;
}

export function triggerTextDownload(content: string, filename: string) {
  downloadTextFile(content, filename);
}

export function formatGatewayType(type: GatewayData["type"]) {
  switch (type) {
    case "GUACD":
      return "GUACD";
    case "MANAGED_SSH":
      return "Managed SSH";
    case "DB_PROXY":
      return "DB Proxy";
    default:
      return "SSH Bastion";
  }
}

export function getGatewayEndpointValue(gateway: GatewayData) {
  if (gateway.deploymentMode === "MANAGED_GROUP") {
    return `Managed group · service port ${gateway.port}`;
  }

  return `${gateway.host}:${gateway.port}`;
}

export function getGatewayInventorySearchText(gateway: GatewayData) {
  return [
    gateway.name,
    gateway.description ?? "",
    formatGatewayType(gateway.type),
    getGatewayModeBadge(gateway),
    gateway.isDefault ? "default" : "",
    gateway.publishPorts ? "published" : "",
    getGatewayEndpointValue(gateway),
    gateway.host,
    String(gateway.port),
    gateway.operationalReason,
  ]
    .join(" ")
    .toLowerCase();
}

export function getGatewayHealthMeta(
  gateway: GatewayData,
  testState?: GatewayTestState,
) {
  if (gateway.tunnelEnabled) {
    if (gateway.operationalStatus === "HEALTHY") {
      return {
        label: "Tunnel healthy",
        tone: "success" as const,
        description: gateway.operationalReason,
      };
    }

    if (gateway.operationalStatus === "DEGRADED") {
      return {
        label: "Tunnel degraded",
        tone: "warning" as const,
        description: gateway.operationalReason,
      };
    }

    return gateway.operationalStatus === "UNHEALTHY"
      ? {
          label: "Tunnel unhealthy",
          tone: "destructive" as const,
          description: gateway.operationalReason,
        }
      : {
          label: "Tunnel status unknown",
          tone: "neutral" as const,
          description: gateway.operationalReason,
        };
  }

  if (isGatewayGroup(gateway)) {
    if (gateway.totalInstances === 0 && gateway.desiredReplicas === 0) {
      return {
        label: "No deployed instances",
        tone: "neutral" as const,
        description: gateway.operationalReason,
      };
    }

    if (gateway.totalInstances === 0) {
      return {
        label: "No instances online",
        tone: "destructive" as const,
        description: gateway.operationalReason,
      };
    }

    return {
      label: `${gateway.healthyInstances}/${gateway.totalInstances} healthy`,
      tone: gatewayStatusTone(gateway.operationalStatus),
      description: gateway.operationalReason,
    };
  }

  if (testState?.loading) {
    return {
      label: "Connectivity test running",
      tone: "neutral" as const,
      description: "A live connectivity test is in progress.",
    };
  }

  if (gateway.operationalStatus === "HEALTHY") {
    return {
      label:
        gateway.lastLatencyMs != null
          ? `Reachable in ${gateway.lastLatencyMs} ms`
          : "Reachable",
      tone: "success" as const,
      description: gateway.operationalReason,
    };
  }

  if (gateway.operationalStatus === "UNHEALTHY") {
    return {
      label: gateway.lastError || "Unreachable",
      tone: "destructive" as const,
      description: gateway.operationalReason,
    };
  }

  return gateway.operationalStatus === "DEGRADED"
    ? {
        label: "Gateway degraded",
        tone: "warning" as const,
        description: gateway.operationalReason,
      }
    : {
        label: "Gateway status unknown",
        tone: "neutral" as const,
        description: gateway.operationalReason,
      };
}

export function getGatewayTunnelMeta(
  gateway: GatewayData,
  tunnelStatus?: TunnelStatusEvent,
) {
  if (!gateway.tunnelEnabled) {
    return {
      label: "Tunnel disabled",
      tone: "neutral" as const,
      description: "This gateway does not use the zero-trust tunnel.",
    };
  }

  const connected = tunnelStatus?.connected ?? gateway.tunnelConnected;
  const connectedAt = tunnelStatus?.connectedAt ?? gateway.tunnelConnectedAt;
  const rttMs = tunnelStatus?.rttMs;
  const activeStreams = tunnelStatus?.activeStreams;

  if (connected) {
    const details = [];
    if (connectedAt)
      details.push(`Connected ${new Date(connectedAt).toLocaleString()}`);
    if (rttMs != null) details.push(`RTT ${rttMs} ms`);
    if (activeStreams != null) details.push(`${activeStreams} active streams`);

    return {
      label: "Tunnel connected",
      tone: "success" as const,
      description:
        details.join(" · ") || "The outbound tunnel is currently connected.",
    };
  }

  return {
    label: "Tunnel disconnected",
    tone: "destructive" as const,
    description: "The outbound tunnel is enabled but not currently connected.",
  };
}

export function isGatewayExpandable(gateway: GatewayData) {
  return (
    isGatewayGroup(gateway) &&
    (gateway.type === "MANAGED_SSH" ||
      gateway.type === "GUACD" ||
      gateway.type === "DB_PROXY")
  );
}

export function getGatewayModeBadge(gateway: GatewayData) {
  return isGatewayGroup(gateway)
    ? gatewayModeLabel(gateway)
    : "Single instance";
}
