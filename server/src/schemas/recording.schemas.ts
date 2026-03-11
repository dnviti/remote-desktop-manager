import { z } from 'zod';

export const listRecordingsQuerySchema = z.object({
  connectionId: z.string().uuid().optional(),
  protocol: z.enum(['SSH', 'RDP', 'VNC']).optional(),
  status: z.enum(['RECORDING', 'COMPLETE', 'ERROR']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type ListRecordingsQueryInput = z.infer<typeof listRecordingsQuerySchema>;
