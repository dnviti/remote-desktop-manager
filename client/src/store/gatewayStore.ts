import { create } from 'zustand';
import {
  GatewayData, GatewayInput, GatewayUpdate, SshKeyPairData,
  listGateways, createGateway as createGatewayApi,
  updateGateway as updateGatewayApi, deleteGateway as deleteGatewayApi,
  getSshKeyPair, generateSshKeyPair as generateSshKeyPairApi,
  rotateSshKeyPair as rotateSshKeyPairApi,
  pushKeyToGateway as pushKeyToGatewayApi,
  type RotateKeyPairResponse,
  type GatewayHealthEvent,
  type ActiveSessionData,
  type ManagedInstanceData,
  type ScalingStatusData,
  type ScalingConfigInput,
  type GatewayTemplateData,
  type GatewayTemplateInput,
  type GatewayTemplateUpdate,
  type TunnelTokenResponse,
  type TunnelOverviewData,
  fetchTunnelOverview as fetchTunnelOverviewApi,
  listActiveSessions as listActiveSessionsApi,
  getSessionCount as getSessionCountApi,
  getSessionCountByGateway as getSessionCountByGatewayApi,
  terminateSession as terminateSessionApi,
  deployGateway as deployGatewayApi,
  undeployGateway as undeployGatewayApi,
  scaleGateway as scaleGatewayApi,
  listGatewayInstances as listGatewayInstancesApi,
  restartGatewayInstance as restartGatewayInstanceApi,
  getScalingStatus as getScalingStatusApi,
  updateScalingConfig as updateScalingConfigApi,
  listGatewayTemplates as listGatewayTemplatesApi,
  createGatewayTemplate as createGatewayTemplateApi,
  updateGatewayTemplate as updateGatewayTemplateApi,
  deleteGatewayTemplate as deleteGatewayTemplateApi,
  deployFromTemplate as deployFromTemplateApi,
  generateTunnelToken as generateTunnelTokenApi,
  revokeTunnelToken as revokeTunnelTokenApi,
} from '../api/gateway.api';

export interface TunnelStatusEvent {
  gatewayId: string;
  connected: boolean;
  connectedAt: string | null;
  rttMs: number | null;
  activeStreams: number;
  agentVersion: string | null;
  checkedAt: string;
}

interface GatewayState {
  gateways: GatewayData[];
  loading: boolean;
  sshKeyPair: SshKeyPairData | null;
  sshKeyLoading: boolean;
  tunnelStatuses: Record<string, TunnelStatusEvent>;

  // Orchestration state
  activeSessions: ActiveSessionData[];
  sessionCount: number;
  sessionCountByGateway: Array<{ gatewayId: string; gatewayName: string; count: number }>;
  scalingStatus: Record<string, ScalingStatusData>;
  instances: Record<string, ManagedInstanceData[]>;
  sessionsLoading: boolean;

  // Gateway CRUD actions
  fetchGateways: () => Promise<void>;
  createGateway: (data: GatewayInput) => Promise<GatewayData>;
  updateGateway: (id: string, data: GatewayUpdate) => Promise<void>;
  deleteGateway: (id: string, force?: boolean) => Promise<void>;
  applyHealthUpdate: (event: GatewayHealthEvent) => void;
  applyInstancesUpdate: (gatewayId: string, instances: ManagedInstanceData[]) => void;
  applyScalingUpdate: (gatewayId: string, scalingStatus: ScalingStatusData) => void;
  applyGatewayUpdate: (gatewayId: string, gatewayPartial: Partial<GatewayData>) => void;

  // SSH key actions
  fetchSshKeyPair: () => Promise<void>;
  generateSshKeyPair: () => Promise<SshKeyPairData>;
  rotateSshKeyPair: () => Promise<RotateKeyPairResponse>;
  pushKeyToGateway: (id: string) => Promise<{ ok: boolean; error?: string }>;

  // Session monitoring actions
  fetchActiveSessions: (filters?: { protocol?: 'SSH' | 'RDP'; gatewayId?: string }) => Promise<void>;
  fetchSessionCount: () => Promise<void>;
  fetchSessionCountByGateway: () => Promise<void>;
  terminateSession: (sessionId: string) => Promise<void>;

  // Managed gateway lifecycle actions
  fetchScalingStatus: (gatewayId: string) => Promise<void>;
  fetchInstances: (gatewayId: string) => Promise<void>;
  deployGateway: (id: string) => Promise<void>;
  undeployGateway: (id: string) => Promise<void>;
  scaleGateway: (id: string, replicas: number) => Promise<void>;
  updateScalingConfig: (id: string, config: ScalingConfigInput) => Promise<void>;
  restartInstance: (gatewayId: string, instanceId: string) => Promise<void>;

  // Template state & actions
  templates: GatewayTemplateData[];
  templatesLoading: boolean;
  fetchTemplates: () => Promise<void>;
  createTemplate: (data: GatewayTemplateInput) => Promise<GatewayTemplateData>;
  updateTemplate: (id: string, data: GatewayTemplateUpdate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  deployFromTemplate: (templateId: string) => Promise<GatewayData>;

  // Tunnel token actions
  generateTunnelToken: (gatewayId: string) => Promise<TunnelTokenResponse>;
  revokeTunnelToken: (gatewayId: string) => Promise<void>;
  applyTunnelStatusUpdate: (event: TunnelStatusEvent) => void;

  // Tunnel fleet overview
  tunnelOverview: TunnelOverviewData | null;
  tunnelOverviewLoading: boolean;
  fetchTunnelOverview: () => Promise<void>;

  reset: () => void;
}

const initialOrchestrationState = {
  activeSessions: [] as ActiveSessionData[],
  sessionCount: 0,
  sessionCountByGateway: [] as Array<{ gatewayId: string; gatewayName: string; count: number }>,
  scalingStatus: {} as Record<string, ScalingStatusData>,
  instances: {} as Record<string, ManagedInstanceData[]>,
  sessionsLoading: false,
  templates: [] as GatewayTemplateData[],
  templatesLoading: false,
  tunnelStatuses: {} as Record<string, TunnelStatusEvent>,
  tunnelOverview: null as TunnelOverviewData | null,
  tunnelOverviewLoading: false,
};

export const useGatewayStore = create<GatewayState>((set) => ({
  gateways: [],
  loading: false,
  sshKeyPair: null,
  sshKeyLoading: false,
  ...initialOrchestrationState,

  fetchGateways: async () => {
    set({ loading: true });
    try {
      const gateways = await listGateways();
      set({ gateways, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createGateway: async (data) => {
    const gateway = await createGatewayApi(data);
    const gateways = await listGateways();
    set({ gateways });
    return gateway;
  },

  updateGateway: async (id, data) => {
    const updated = await updateGatewayApi(id, data);
    set((state) => ({
      gateways: state.gateways.map((g) => (g.id === id ? { ...g, ...updated } : g)),
    }));
  },

  deleteGateway: async (id, force) => {
    await deleteGatewayApi(id, force);
    set((state) => ({
      gateways: state.gateways.filter((g) => g.id !== id),
    }));
  },

  applyHealthUpdate: (event) => {
    set((state) => ({
      gateways: state.gateways.map((g) =>
        g.id === event.gatewayId
          ? {
              ...g,
              lastHealthStatus: event.status,
              lastLatencyMs: event.latencyMs,
              lastError: event.error,
              lastCheckedAt: event.checkedAt,
            }
          : g,
      ),
    }));
  },

  applyInstancesUpdate: (gatewayId, instances) => {
    set((state) => ({
      instances: { ...state.instances, [gatewayId]: instances },
    }));
  },

  applyScalingUpdate: (gatewayId, scalingStatus) => {
    set((state) => ({
      scalingStatus: { ...state.scalingStatus, [gatewayId]: scalingStatus },
    }));
  },

  applyGatewayUpdate: (gatewayId, gatewayPartial) => {
    set((state) => ({
      gateways: state.gateways.map((g) =>
        g.id === gatewayId ? { ...g, ...gatewayPartial } : g,
      ),
    }));
  },

  fetchSshKeyPair: async () => {
    set({ sshKeyLoading: true });
    try {
      const sshKeyPair = await getSshKeyPair();
      set({ sshKeyPair, sshKeyLoading: false });
    } catch {
      set({ sshKeyPair: null, sshKeyLoading: false });
    }
  },

  generateSshKeyPair: async () => {
    const sshKeyPair = await generateSshKeyPairApi();
    set({ sshKeyPair });
    return sshKeyPair;
  },

  rotateSshKeyPair: async () => {
    const response = await rotateSshKeyPairApi();
    const { pushResults: _, ...sshKeyPair } = response;
    set({ sshKeyPair });
    return response;
  },

  pushKeyToGateway: async (id) => {
    return await pushKeyToGatewayApi(id);
  },

  // ---------- Session monitoring ----------

  fetchActiveSessions: async (filters) => {
    set({ sessionsLoading: true });
    try {
      const activeSessions = await listActiveSessionsApi(filters);
      set({ activeSessions, sessionsLoading: false });
    } catch {
      set({ sessionsLoading: false });
    }
  },

  fetchSessionCount: async () => {
    try {
      const { count } = await getSessionCountApi();
      set({ sessionCount: count });
    } catch {
      // ignore
    }
  },

  fetchSessionCountByGateway: async () => {
    try {
      const sessionCountByGateway = await getSessionCountByGatewayApi();
      set({ sessionCountByGateway });
    } catch {
      // ignore
    }
  },

  terminateSession: async (sessionId) => {
    await terminateSessionApi(sessionId);
    set((state) => ({
      activeSessions: state.activeSessions.filter((s) => s.id !== sessionId),
      sessionCount: Math.max(0, state.sessionCount - 1),
    }));
  },

  // ---------- Managed gateway lifecycle ----------

  fetchScalingStatus: async (gatewayId) => {
    try {
      const status = await getScalingStatusApi(gatewayId);
      set((state) => ({
        scalingStatus: { ...state.scalingStatus, [gatewayId]: status },
      }));
    } catch {
      // ignore
    }
  },

  fetchInstances: async (gatewayId) => {
    try {
      const instanceList = await listGatewayInstancesApi(gatewayId);
      set((state) => ({
        instances: { ...state.instances, [gatewayId]: instanceList },
      }));
    } catch {
      // ignore
    }
  },

  deployGateway: async (id) => {
    await deployGatewayApi(id);
    // Socket events (instances:updated, gateway:updated, scaling:updated) handle UI refresh
  },

  undeployGateway: async (id) => {
    await undeployGatewayApi(id);
    // Socket events handle UI refresh
  },

  scaleGateway: async (id, replicas) => {
    await scaleGatewayApi(id, replicas);
    // Socket events handle UI refresh
  },

  updateScalingConfig: async (id, config) => {
    await updateScalingConfigApi(id, config);
    // Socket events handle UI refresh
  },

  restartInstance: async (gatewayId, instanceId) => {
    // Optimistically show "restarting" status
    set((state) => ({
      instances: {
        ...state.instances,
        [gatewayId]: (state.instances[gatewayId] ?? []).map((inst) =>
          inst.id === instanceId
            ? { ...inst, healthStatus: 'restarting' }
            : inst,
        ),
      },
    }));
    await restartGatewayInstanceApi(gatewayId, instanceId);
    // Socket event (instances:updated) will push the real status
  },

  // ---------- Gateway templates ----------

  fetchTemplates: async () => {
    set({ templatesLoading: true });
    try {
      const templates = await listGatewayTemplatesApi();
      set({ templates, templatesLoading: false });
    } catch {
      set({ templatesLoading: false });
    }
  },

  createTemplate: async (data) => {
    const template = await createGatewayTemplateApi(data);
    const templates = await listGatewayTemplatesApi();
    set({ templates });
    return template;
  },

  updateTemplate: async (id, data) => {
    const updated = await updateGatewayTemplateApi(id, data);
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTemplate: async (id) => {
    await deleteGatewayTemplateApi(id);
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
    }));
  },

  deployFromTemplate: async (templateId) => {
    const gateway = await deployFromTemplateApi(templateId);
    const [gateways, templates] = await Promise.all([
      listGateways(),
      listGatewayTemplatesApi(),
    ]);
    set({ gateways, templates });
    return gateway;
  },

  // ---------- Tunnel token actions ----------

  generateTunnelToken: async (gatewayId) => {
    const result = await generateTunnelTokenApi(gatewayId);
    set((state) => ({
      gateways: state.gateways.map((g) =>
        g.id === gatewayId ? { ...g, tunnelEnabled: result.tunnelEnabled, tunnelConnected: result.tunnelConnected } : g,
      ),
    }));
    return result;
  },

  revokeTunnelToken: async (gatewayId) => {
    await revokeTunnelTokenApi(gatewayId);
    set((state) => ({
      gateways: state.gateways.map((g) =>
        g.id === gatewayId ? { ...g, tunnelEnabled: false, tunnelConnected: false } : g,
      ),
    }));
  },

  applyTunnelStatusUpdate: (event) => {
    set((state) => ({
      tunnelStatuses: { ...state.tunnelStatuses, [event.gatewayId]: event },
      gateways: state.gateways.map((g) =>
        g.id === event.gatewayId ? { ...g, tunnelConnected: event.connected } : g,
      ),
    }));
  },

  fetchTunnelOverview: async () => {
    set({ tunnelOverviewLoading: true });
    try {
      const tunnelOverview = await fetchTunnelOverviewApi();
      set({ tunnelOverview, tunnelOverviewLoading: false });
    } catch {
      set({ tunnelOverviewLoading: false });
    }
  },

  reset: () => set({
    gateways: [], loading: false, sshKeyPair: null, sshKeyLoading: false,
    ...initialOrchestrationState,
  }),
}));
