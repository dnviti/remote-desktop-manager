import { z } from 'zod';

export const exportSchema = z.object({
  format: z.enum(['CSV', 'JSON']),
  includeCredentials: z.boolean().default(false),
  connectionIds: z.array(z.string().uuid()).optional(),
  folderId: z.string().uuid().optional(),
});
export type ExportInput = z.infer<typeof exportSchema>;

export const importSchema = z.object({
  duplicateStrategy: z.enum(['SKIP', 'OVERWRITE', 'RENAME']).default('SKIP'),
  format: z.enum(['CSV', 'JSON', 'MREMOTENG', 'RDP']).optional(),
});
export type ImportInput = z.infer<typeof importSchema>;
