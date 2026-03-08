-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SFTP_UPLOAD';
ALTER TYPE "AuditAction" ADD VALUE 'SFTP_DOWNLOAD';
ALTER TYPE "AuditAction" ADD VALUE 'SFTP_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'SFTP_MKDIR';
ALTER TYPE "AuditAction" ADD VALUE 'SFTP_RENAME';
ALTER TYPE "AuditAction" ADD VALUE 'VAULT_AUTO_LOCK';
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_TERMINATE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_EXTERNAL_REVOKE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_SHARE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_RECONCILE';
ALTER TYPE "AuditAction" ADD VALUE 'CONNECTION_FAVORITE';
