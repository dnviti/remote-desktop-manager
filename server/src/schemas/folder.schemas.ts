import { z } from 'zod';

export const createFolderSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
