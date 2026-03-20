import { z } from 'zod';

export const keystrokePolicyActionEnum = z.enum(['BLOCK_AND_TERMINATE', 'ALERT_ONLY']);

/** Maximum length of a single regex pattern. */
const MAX_PATTERN_LENGTH = 500;
/** Maximum number of patterns per policy. */
const MAX_PATTERNS = 50;

const regexPattern = z.string().min(1).max(MAX_PATTERN_LENGTH, `Pattern must not exceed ${MAX_PATTERN_LENGTH} characters`).refine(
  (val) => {
    try {
      new RegExp(val);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid regular expression pattern' },
);

export const createKeystrokePolicySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  action: keystrokePolicyActionEnum,
  regexPatterns: z.array(regexPattern).min(1, 'At least one regex pattern is required').max(MAX_PATTERNS, `At most ${MAX_PATTERNS} patterns allowed`),
  enabled: z.boolean().optional(),
});
export type CreateKeystrokePolicyInput = z.infer<typeof createKeystrokePolicySchema>;

export const updateKeystrokePolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  action: keystrokePolicyActionEnum.optional(),
  regexPatterns: z.array(regexPattern).min(1, 'At least one regex pattern is required').max(MAX_PATTERNS, `At most ${MAX_PATTERNS} patterns allowed`).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateKeystrokePolicyInput = z.infer<typeof updateKeystrokePolicySchema>;
