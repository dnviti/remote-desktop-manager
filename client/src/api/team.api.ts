import api from './client';

export interface TeamData {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  myRole: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TeamMember {
  userId: string;
  email: string;
  username: string | null;
  avatarData: string | null;
  role: string;
  joinedAt: string;
}

export async function createTeam(
  name: string,
  description?: string,
): Promise<TeamData> {
  const res = await api.post('/teams', { name, description });
  return res.data;
}

export async function listTeams(): Promise<TeamData[]> {
  const res = await api.get('/teams');
  return res.data;
}

export async function getTeam(id: string): Promise<TeamData> {
  const res = await api.get(`/teams/${id}`);
  return res.data;
}

export async function updateTeam(
  id: string,
  data: { name?: string; description?: string | null },
): Promise<TeamData> {
  const res = await api.put(`/teams/${id}`, data);
  return res.data;
}

export async function deleteTeam(id: string): Promise<{ deleted: boolean }> {
  const res = await api.delete(`/teams/${id}`);
  return res.data;
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const res = await api.get(`/teams/${teamId}/members`);
  return res.data;
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER',
): Promise<TeamMember> {
  const res = await api.post(`/teams/${teamId}/members`, { userId, role });
  return res.data;
}

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER',
): Promise<{ userId: string; role: string }> {
  const res = await api.put(`/teams/${teamId}/members/${userId}`, { role });
  return res.data;
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<{ removed: boolean }> {
  const res = await api.delete(`/teams/${teamId}/members/${userId}`);
  return res.data;
}
