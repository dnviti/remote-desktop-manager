import { create } from 'zustand';
import { getPublicConfig } from '../api/auth.api';
import type { FeatureFlags } from '../api/auth.api';

interface FeatureFlagsState extends FeatureFlags {
  loaded: boolean;
  fetchFeatureFlags: () => Promise<void>;
}

export const useFeatureFlagsStore = create<FeatureFlagsState>((set) => ({
  // Defaults match server defaults (all enabled) — fail-open
  databaseProxyEnabled: true,
  connectionsEnabled: true,
  keychainEnabled: true,
  recordingsEnabled: true,
  zeroTrustEnabled: true,
  agenticAIEnabled: true,
  enterpriseAuthEnabled: true,
  sharingApprovalsEnabled: true,
  cliEnabled: true,
  mode: 'production',
  backend: 'podman',
  routing: {
    directGateway: true,
    zeroTrust: true,
  },
  loaded: false,

  fetchFeatureFlags: async () => {
    try {
      const cfg = await getPublicConfig();
      set({ ...cfg.features, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
