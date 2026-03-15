import { z } from 'zod';

/** Validates a single time window in "HH:MM-HH:MM" format. */
const timeWindowRegex = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

function isValidTimeWindow(w: string): boolean {
  if (!timeWindowRegex.test(w)) return false;
  const [startStr, endStr] = w.split('-');
  if (!startStr || !endStr) return false;
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  if (sh < 0 || sh > 23 || sm < 0 || sm > 59) return false;
  if (eh < 0 || eh > 23 || em < 0 || em > 59) return false;
  return true;
}

const timeWindowsString = z.string().refine(
  (val) => val.split(',').map((w) => w.trim()).every(isValidTimeWindow),
  { message: 'Each time window must be in "HH:MM-HH:MM" format (hours 0-23, minutes 0-59)' },
);

export const createAccessPolicySchema = z.object({
  targetType: z.enum(['TENANT', 'TEAM', 'FOLDER']),
  targetId: z.string().uuid(),
  allowedTimeWindows: timeWindowsString.optional().nullable(),
  requireTrustedDevice: z.boolean().optional(),
  requireMfaStepUp: z.boolean().optional(),
});
export type CreateAccessPolicyInput = z.infer<typeof createAccessPolicySchema>;

export const updateAccessPolicySchema = z.object({
  allowedTimeWindows: timeWindowsString.optional().nullable(),
  requireTrustedDevice: z.boolean().optional(),
  requireMfaStepUp: z.boolean().optional(),
});
export type UpdateAccessPolicyInput = z.infer<typeof updateAccessPolicySchema>;
