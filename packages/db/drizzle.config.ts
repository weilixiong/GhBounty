import { config as dotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local first (gitignored, holds the real DATABASE_URL), then .env
// as a fallback. Matches the .env.local convention used elsewhere in the repo
// (frontend/.env.local). Variables already set in the shell win over both.
dotenv({ path: ".env.local" });
dotenv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error(
    "[drizzle.config] DATABASE_URL is not set. " +
      "Copy packages/db/.env.example to packages/db/.env.local and fill it in.",
  );
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
