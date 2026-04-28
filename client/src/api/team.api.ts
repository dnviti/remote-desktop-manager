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
  expiresAt: string | null;
  expired: boolean;
}

export async function createTeam(
  name: string,
  description?: string,
): Promise<TeamData> {
  const { data } = await api.post('/teams', { name, description });
  return data;
}

export async function listTeams(scope?: 'tenant'): Promise<TeamData[]> {
  const { data } = await api.get('/teams', { params: scope ? { scope } : undefined });
  return data;
}

export async function getTeam(id: string): Promise<TeamData> {
  const { data } = await api.get(`/teams/${id}`);
  return data;
}

export async function updateTeam(
  id: string,
  payload: { name?: string; description?: string | null },
): Promise<TeamData> {
  const { data } = await api.put(`/teams/${id}`, payload);
  return data;
}

export async function deleteTeam(id: string): Promise<{ deleted: boolean }> {
  const { data } = await api.delete(`/teams/${id}`);
  return data;
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const { data } = await api.get(`/teams/${teamId}/members`);
  return data;
}

export async function addTeamMember(
  teamId: string,
  userId: string,
  role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER',
  expiresAt?: string,
): Promise<TeamMember> {
  const { data } = await api.post(`/teams/${teamId}/members`, { userId, role, ...(expiresAt && { expiresAt }) });
  return data;
}

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER',
): Promise<{ userId: string; role: string }> {
  const { data } = await api.put(`/teams/${teamId}/members/${userId}`, { role });
  return data;
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<{ removed: boolean }> {
  const { data } = await api.delete(`/teams/${teamId}/members/${userId}`);
  return data;
}

export async function updateTeamMemberExpiry(
  teamId: string,
  userId: string,
  expiresAt: string | null,
): Promise<void> {
  await api.patch(`/teams/${teamId}/members/${userId}/expiry`, { expiresAt });
}
