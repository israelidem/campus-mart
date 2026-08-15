import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations and Studio must not run through a connection pooler: the pooler
    // cannot hold the advisory lock and session state that DDL needs. The app
    // runtime still uses the pooled DATABASE_URL.
    url: process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
});
