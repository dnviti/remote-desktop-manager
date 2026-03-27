import './env';
import { readRequiredSecret } from '../utils/secrets';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = readRequiredSecret('database_url', 'DATABASE_URL', 'PostgreSQL connection string (DATABASE_URL)');

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
export { Prisma, ConnectionType, GatewayType, GatewayHealthStatus, Permission, AuditAction, NotificationType, TeamRole, SecretType, SecretScope, SessionProtocol, SessionStatus, ManagedInstanceStatus, LoadBalancingStrategy, RecordingStatus, SyncProvider, SyncStatus, AccessPolicyTargetType, CheckoutStatus, RotationStatus, RotationTrigger, RotationTargetOS, DbQueryType, FirewallAction, MaskingStrategy, RateLimitAction, KeystrokePolicyAction } from '../generated/prisma/client';
