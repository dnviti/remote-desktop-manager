import { z } from 'zod';

/** Request body for enabling tunnel on a gateway (POST /gateways/:id/tunnel-token). */
export const generateTunnelTokenSchema = z.object({
  // No body fields required — token is auto-generated server-side.
});
export type GenerateTunnelTokenInput = z.infer<typeof generateTunnelTokenSchema>;

/** Query parameters accepted when listing tunnel status. */
export const tunnelStatusQuerySchema = z.object({
  gatewayId: z.string().uuid(),
});
export type TunnelStatusQuery = z.infer<typeof tunnelStatusQuerySchema>;
