import { z } from 'zod';

export const createTeamSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['TEAM_ADMIN', 'TEAM_EDITOR', 'TEAM_VIEWER']),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({
  role: z.enum(['TEAM_ADMIN', 'TEAM_EDITOR', 'TEAM_VIEWER']),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;
