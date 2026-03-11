import { z } from 'zod';
import { passwordSchema } from '../utils/validate';

export const vaultSetupSchema = z.object({
  vaultPassword: passwordSchema,
});
export type VaultSetupInput = z.infer<typeof vaultSetupSchema>;
