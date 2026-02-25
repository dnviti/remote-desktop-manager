import { create } from 'zustand';
import { ConnectionData, listConnections } from '../api/connections.api';

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
}

interface ConnectionsState {
  ownConnections: ConnectionData[];
  sharedConnections: ConnectionData[];
  folders: Folder[];
  loading: boolean;
  fetchConnections: () => Promise<void>;
  setFolders: (folders: Folder[]) => void;
}

export const useConnectionsStore = create<ConnectionsState>((set) => ({
  ownConnections: [],
  sharedConnections: [],
  folders: [],
  loading: false,

  fetchConnections: async () => {
    set({ loading: true });
    try {
      const data = await listConnections();
      set({
        ownConnections: data.own,
        sharedConnections: data.shared,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  setFolders: (folders) => set({ folders }),
}));
