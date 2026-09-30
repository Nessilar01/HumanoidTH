import "dotenv/config";
import { defineConfig } from "prisma/config";

// ---------------------------------------------------------------------------
// Baseline B2 (setup):
//  - Upstream used env("DATABASE_URL"), which THROWS when the variable is unset.
//    `pnpm install` runs `prisma generate` in postinstall, so a fresh clone
//    failed to install before the developer had a chance to create .env.
//    `prisma generate` does not connect to the DB, so an empty URL is fine here;
//    commands that do connect (db push, seed) still fail with a clear error.
//  - Upstream seed used node_modules/.bin/tsx.CMD, which exists only on Windows.
//    `node --import tsx` works on Windows, macOS and Linux.
// ---------------------------------------------------------------------------
export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? ""
  },
  migrations: {
    path: "prisma/migrations",
    seed: "node --import tsx prisma/seed.ts"
  }
});
