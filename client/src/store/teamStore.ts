import { create } from 'zustand';
import {
  TeamData, TeamMember,
  listTeams, createTeam as createTeamApi, getTeam, updateTeam as updateTeamApi,
  deleteTeam as deleteTeamApi, listTeamMembers, addTeamMember as addTeamMemberApi,
  updateTeamMemberRole as updateMemberRoleApi, removeTeamMember as removeMemberApi,
} from '../api/team.api';

interface TeamState {
  teams: TeamData[];
  loading: boolean;

  selectedTeam: TeamData | null;
  members: TeamMember[];
  membersLoading: boolean;

  fetchTeams: () => Promise<void>;
  createTeam: (name: string, description?: string) => Promise<TeamData>;
  updateTeam: (teamId: string, data: { name?: string; description?: string | null }) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;

  selectTeam: (teamId: string) => Promise<void>;
  clearSelectedTeam: () => void;
  fetchMembers: (teamId: string) => Promise<void>;
  addMember: (teamId: string, userId: string, role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER') => Promise<void>;
  updateMemberRole: (teamId: string, userId: string, role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER') => Promise<void>;
  removeMember: (teamId: string, userId: string) => Promise<void>;
  reset: () => void;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  loading: false,

  selectedTeam: null,
  members: [],
  membersLoading: false,

  fetchTeams: async () => {
    set({ loading: true });
    try {
      const teams = await listTeams();
      set({ teams, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createTeam: async (name, description) => {
    const team = await createTeamApi(name, description);
    await get().fetchTeams();
    return team;
  },

  updateTeam: async (teamId, data) => {
    const updated = await updateTeamApi(teamId, data);
    set((state) => ({
      teams: state.teams.map((t) => (t.id === teamId ? { ...t, ...updated } : t)),
      selectedTeam: state.selectedTeam?.id === teamId ? { ...state.selectedTeam, ...updated } : state.selectedTeam,
    }));
  },

  deleteTeam: async (teamId) => {
    await deleteTeamApi(teamId);
    set((state) => ({
      teams: state.teams.filter((t) => t.id !== teamId),
      selectedTeam: state.selectedTeam?.id === teamId ? null : state.selectedTeam,
      members: state.selectedTeam?.id === teamId ? [] : state.members,
    }));
  },

  selectTeam: async (teamId) => {
    set({ membersLoading: true });
    try {
      const [team, members] = await Promise.all([
        getTeam(teamId),
        listTeamMembers(teamId),
      ]);
      set({ selectedTeam: team, members, membersLoading: false });
    } catch {
      set({ membersLoading: false });
    }
  },

  clearSelectedTeam: () => set({ selectedTeam: null, members: [] }),

  fetchMembers: async (teamId) => {
    set({ membersLoading: true });
    try {
      const members = await listTeamMembers(teamId);
      set({ members, membersLoading: false });
    } catch {
      set({ membersLoading: false });
    }
  },

  addMember: async (teamId, userId, role) => {
    await addTeamMemberApi(teamId, userId, role);
    await get().fetchMembers(teamId);
  },

  updateMemberRole: async (teamId, userId, role) => {
    await updateMemberRoleApi(teamId, userId, role);
    await get().fetchMembers(teamId);
  },

  removeMember: async (teamId, userId) => {
    await removeMemberApi(teamId, userId);
    await get().fetchMembers(teamId);
  },

  reset: () => set({
    teams: [],
    loading: false,
    selectedTeam: null,
    members: [],
    membersLoading: false,
  }),
}));
