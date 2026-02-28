import path from "path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env from the monorepo root (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  migrate: {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async seed(_prisma) {},
  },
  datasource: {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    url: process.env.DATABASE_URL!,
  },
});
