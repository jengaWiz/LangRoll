import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { createPool } from "../../src/db.js";
import { testDatabaseUrl } from "./helpers.js";

let app: FastifyInstance;
let pool: pg.Pool;

afterEach(async () => {
  await app.close();
  await pool.end();
});

function start(databaseUrl: string) {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: databaseUrl, SUPABASE_URL: "http://127.0.0.1:54321" });
  pool = createPool(config.DATABASE_URL);
  app = buildApp(config, { db: pool, verifyToken: async () => ({ userId: "unused", isAnonymous: true }) });
  return app;
}

describe("GET /ready against Postgres", () => {
  it("is ready with a reachable database", async () => {
    const res = await start(testDatabaseUrl()).inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
  });

  it("returns 503 when the database refuses connections", async () => {
    const url = new URL(testDatabaseUrl());
    url.port = "1"; // nothing listens here
    const res = await start(url.toString()).inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
  });
});
