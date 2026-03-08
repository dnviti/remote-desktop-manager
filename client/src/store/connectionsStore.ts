import { create } from 'zustand';
import { ConnectionData, listConnections, updateConnection, toggleFavorite as toggleFavoriteApi } from '../api/connections.api';
import { FolderData, listFolders } from '../api/folders.api';

export type Folder = FolderData;

interface ConnectionsState {
  ownConnections: ConnectionData[];
  sharedConnections: ConnectionData[];
  teamConnections: ConnectionData[];
  folders: Folder[];
  teamFolders: Folder[];
  loading: boolean;
  fetchConnections: () => Promise<void>;
  fetchFolders: () => Promise<void>;
  toggleFavorite: (connectionId: string) => Promise<void>;
  moveConnection: (connectionId: string, targetFolderId: string | null) => Promise<void>;
  reset: () => void;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  ownConnections: [],
  sharedConnections: [],
  teamConnections: [],
  folders: [],
  teamFolders: [],
  loading: false,

  fetchConnections: async () => {
    set({ loading: true });
    try {
      const [connData, foldersData] = await Promise.all([
        listConnections(),
        listFolders(),
      ]);
      set({
        ownConnections: connData.own,
        sharedConnections: connData.shared,
        teamConnections: connData.team,
        folders: foldersData.personal,
        teamFolders: foldersData.team,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  fetchFolders: async () => {
    try {
      const foldersData = await listFolders();
      set({ folders: foldersData.personal, teamFolders: foldersData.team });
    } catch {}
  },

  toggleFavorite: async (connectionId) => {
    try {
      const result = await toggleFavoriteApi(connectionId);
      set((state) => ({
        ownConnections: state.ownConnections.map((c) =>
          c.id === result.id ? { ...c, isFavorite: result.isFavorite } : c
        ),
        teamConnections: state.teamConnections.map((c) =>
          c.id === result.id ? { ...c, isFavorite: result.isFavorite } : c
        ),
      }));
    } catch {
      // Silently fail; the star just does not toggle
    }
  },

  reset: () => set({
    ownConnections: [],
    sharedConnections: [],
    teamConnections: [],
    folders: [],
    teamFolders: [],
    loading: false,
  }),

  moveConnection: async (connectionId, targetFolderId) => {
    const prevOwn = get().ownConnections;
    const prevTeam = get().teamConnections;
    // Optimistic update (check both own and team)
    set({
      ownConnections: prevOwn.map((c) =>
        c.id === connectionId ? { ...c, folderId: targetFolderId } : c
      ),
      teamConnections: prevTeam.map((c) =>
        c.id === connectionId ? { ...c, folderId: targetFolderId } : c
      ),
    });
    try {
      await updateConnection(connectionId, { folderId: targetFolderId });
      await get().fetchConnections();
    } catch (err) {
      set({ ownConnections: prevOwn, teamConnections: prevTeam });
      throw err;
    }
  },
}));
