-- AlterTable
ALTER TABLE "User" ADD COLUMN "notifDndEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "notifQuietHoursStart" TEXT;
ALTER TABLE "User" ADD COLUMN "notifQuietHoursEnd" TEXT;
ALTER TABLE "User" ADD COLUMN "notifQuietHoursTimezone" TEXT;
