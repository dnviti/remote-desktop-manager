import './env';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
export { Prisma, ConnectionType, GatewayType, GatewayHealthStatus, Permission, AuditAction, NotificationType, TeamRole, SecretType, SecretScope, SessionProtocol, SessionStatus, ManagedInstanceStatus, LoadBalancingStrategy, RecordingStatus, SyncProvider, SyncStatus, AccessPolicyTargetType, RotationStatus, RotationTrigger, RotationTargetOS } from '../generated/prisma/client';
