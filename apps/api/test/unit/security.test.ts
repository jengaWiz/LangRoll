import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { AuthError } from "../../src/auth.js";
import { loadConfig } from "../../src/config.js";
import type { Db } from "../../src/db.js";

const db: Db = {
  query: async () => ({ rows: [], rowCount: 0, command: "SELECT", oid: 0, fields: [] }),
  transaction: (fn) => fn(db),
};
const verifyToken = async () => {
  throw new AuthError("Invalid token.");
};
let app: FastifyInstance;

function start(env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused/db",
    SUPABASE_URL: "http://127.0.0.1:54321",
    CORS_ORIGINS: "https://jengawiz.github.io",
    ...env,
  });
  app = buildApp(config, { db, verifyToken });
  return app;
}

afterEach(async () => {
  await app.close();
});

const hammer = (n: number, headers: (i: number) => Record<string, string> = () => ({})) =>
  Promise.all(Array.from({ length: n }, (_, i) => app.inject({ method: "POST", url: "/events", headers: headers(i), payload: {} })));

describe("security headers", () => {
  it("are set on every response", async () => {
    const res = await start().inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=/);
  });
});

describe("CORS", () => {
  const preflight = (origin: string) =>
    app.inject({
      method: "OPTIONS",
      url: "/me",
      headers: { origin, "access-control-request-method": "PATCH", "access-control-request-headers": "authorization,content-type" },
    });

  it("lets our own site call the API", async () => {
    start();
    const res = await preflight("https://jengawiz.github.io");
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://jengawiz.github.io");
    expect(res.headers["access-control-allow-headers"]).toMatch(/authorization/);
  });

  it("gives other sites no access", async () => {
    start();
    const res = await preflight("https://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("rate limits", () => {
  it("throttles writes after 60 a minute, in the usual error shape", async () => {
    start();
    const results = await hammer(61);
    expect(results.slice(0, 60).every((r) => r.statusCode === 401)).toBe(true);
    const last = results[60]!;
    expect(last.statusCode).toBe(429);
    expect(last.json().error).toMatchObject({ code: "rate_limited" });
    expect(last.headers["retry-after"]).toBeDefined();
  });

  it("never throttles health checks", async () => {
    start();
    const results = await Promise.all(Array.from({ length: 350 }, () => app.inject({ method: "GET", url: "/health" })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });

  it("ignores X-Forwarded-For unless a proxy is configured, so it can't be spoofed", async () => {
    start();
    const results = await hammer(61, (i) => ({ "x-forwarded-for": `203.0.113.${i}` }));
    expect(results[60]!.statusCode).toBe(429);
  });

  it("limits each client separately behind a trusted proxy", async () => {
    start({ TRUST_PROXY_HOPS: "1" });
    const results = await hammer(61, (i) => ({ "x-forwarded-for": `203.0.113.${i}` }));
    expect(results.every((r) => r.statusCode === 401)).toBe(true);
  });
});
