-- CreateTable
CREATE TABLE "OpenTab" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenTab_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenTab_userId_idx" ON "OpenTab"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OpenTab_userId_connectionId_key" ON "OpenTab"("userId", "connectionId");

-- AddForeignKey
ALTER TABLE "OpenTab" ADD CONSTRAINT "OpenTab_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenTab" ADD CONSTRAINT "OpenTab_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
