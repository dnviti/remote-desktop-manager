-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "loginRateLimitWindowMs" INTEGER,
ADD COLUMN "loginRateLimitMaxAttempts" INTEGER,
ADD COLUMN "accountLockoutThreshold" INTEGER,
ADD COLUMN "accountLockoutDurationMs" INTEGER,
ADD COLUMN "impossibleTravelSpeedKmh" INTEGER,
ADD COLUMN "jwtExpiresInSeconds" INTEGER,
ADD COLUMN "jwtRefreshExpiresInSeconds" INTEGER,
ADD COLUMN "vaultDefaultTtlMinutes" INTEGER;
