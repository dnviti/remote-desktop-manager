import { z } from 'zod';

export const fileNameSchema = z.object({
  name: z.string().min(1).max(255),
});

export type FileNameInput = z.infer<typeof fileNameSchema>;
