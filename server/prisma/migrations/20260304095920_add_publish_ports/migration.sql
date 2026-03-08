-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "publishPorts" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "GatewayTemplate" ADD COLUMN     "publishPorts" BOOLEAN NOT NULL DEFAULT false;
