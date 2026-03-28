import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env from the monorepo root (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== "") {
    return process.env.DATABASE_URL;
  }

  const secretsDir = process.env.SECRETS_DIR || "/run/secrets";
  const secretPath = path.join(secretsDir, "database_url");
  try {
    const secretValue = fs.readFileSync(secretPath, "utf8").trim();
    if (secretValue) {
      process.env.DATABASE_URL = secretValue;
      return secretValue;
    }
  } catch {
    // Fall through to the explicit startup error below.
  }

  throw new Error(
    `DATABASE_URL not configured. Set DATABASE_URL or mount ${secretPath} with the database_url secret.`,
  );
}

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  migrate: {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async seed(_prisma) {},
  },
  datasource: {
    url: resolveDatabaseUrl(),
  },
});
