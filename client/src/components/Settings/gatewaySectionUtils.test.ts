import { describe, expect, it } from "vitest";
import {
  formatGatewayType,
  getGatewayEndpointValue,
  getGatewayHealthMeta,
  getGatewayInventorySearchText,
} from "./gatewaySectionUtils";
import type { GatewayData } from "../../api/gateway.api";

function tunnelGateway(overrides: Partial<GatewayData> = {}): GatewayData {
  return {
    id: "gateway-1",
    name: "Tunnel SSH",
    type: "MANAGED_SSH",
    host: "ssh-gateway",
    port: 2222,
    deploymentMode: "MANAGED_GROUP",
    description: null,
    isDefault: false,
    hasSshKey: false,
    apiPort: 9022,
    inactivityTimeoutSeconds: 3600,
    tenantId: "tenant-1",
    createdById: "user-1",
    createdAt: "2026-04-09T00:00:00Z",
    updatedAt: "2026-04-09T00:00:00Z",
    monitoringEnabled: true,
    monitorIntervalMs: 5000,
    lastHealthStatus: "UNKNOWN",
    lastCheckedAt: null,
    lastLatencyMs: null,
    lastError: null,
    isManaged: true,
    publishPorts: false,
    lbStrategy: "ROUND_ROBIN",
    desiredReplicas: 1,
    autoScale: false,
    minReplicas: 1,
    maxReplicas: 1,
    sessionsPerInstance: 10,
    scaleDownCooldownSeconds: 300,
    lastScaleAction: null,
    templateId: null,
    totalInstances: 0,
    healthyInstances: 0,
    runningInstances: 0,
    tunnelEnabled: true,
    tunnelConnected: true,
    tunnelConnectedAt: "2026-04-09T00:00:00Z",
    tunnelClientCertExp: null,
    operationalStatus: "HEALTHY",
    operationalReason: "Tunnel is connected and reporting a healthy heartbeat.",
    ...overrides,
  };
}

describe("getGatewayHealthMeta", () => {
  it("prefers tunnel health over managed group instance counts", () => {
    expect(getGatewayHealthMeta(tunnelGateway())).toEqual({
      label: "Tunnel healthy",
      tone: "success",
      description: "Tunnel is connected and reporting a healthy heartbeat.",
    });
  });

  it("formats gateway labels and builds inventory search text", () => {
    const gateway = tunnelGateway({
      type: "DB_PROXY",
      deploymentMode: "SINGLE_INSTANCE",
      host: "db-proxy.example.com",
      port: 5432,
      isManaged: false,
    });

    expect(formatGatewayType(gateway.type)).toBe("DB Proxy");
    expect(getGatewayEndpointValue(gateway)).toBe("db-proxy.example.com:5432");
    expect(getGatewayInventorySearchText(gateway)).toContain("db-proxy.example.com");
    expect(getGatewayInventorySearchText(gateway)).toContain("db proxy");
  });

  it("formats managed group endpoints for inventory summaries", () => {
    expect(getGatewayEndpointValue(tunnelGateway())).toBe("Managed group · service port 2222");
  });
});
