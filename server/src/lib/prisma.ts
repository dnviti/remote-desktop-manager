import './env';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

export default prisma;
export { Prisma, ConnectionType, GatewayType, GatewayHealthStatus, Permission, AuditAction, NotificationType, TeamRole } from '../generated/prisma/client';
