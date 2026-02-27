import path from "path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env from the monorepo root (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  migrate: {
    async seed(prisma) {},
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
