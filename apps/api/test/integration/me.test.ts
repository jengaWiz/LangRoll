import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../../src/app.js";
import { AuthError, type VerifyToken } from "../../src/auth.js";
import { loadConfig } from "../../src/config.js";
import { createPool } from "../../src/db.js";
import { loadMigrations, migrate } from "../../src/migrate.js";
import { createTestDatabase } from "./helpers.js";

const db = await createTestDatabase();
let pool: pg.Pool;
let app: FastifyInstance;

// Token verification has its own unit tests. Here the "token" is just the user id.
const verifyToken: VerifyToken = async (token) => {
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new AuthError("Invalid token.");
  return { userId: token, isAnonymous: true };
};

beforeAll(async () => {
  pool = createPool(db.url);
  await migrate(pool, await loadMigrations(new URL("../../migrations/", import.meta.url)));
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: db.url, SUPABASE_URL: "http://127.0.0.1:54321" });
  app = buildApp(config, { db: pool, verifyToken });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  await db.drop();
});

const get = (user: string) => app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${user}` } });
const patch = (user: string, body: unknown) =>
  app.inject({ method: "PATCH", url: "/me", headers: { authorization: `Bearer ${user}` }, payload: body as object });
const userCount = async (id: string) =>
  Number((await pool.query("select count(*) as n from app.users where id = $1", [id])).rows[0].n);

describe("GET /me", () => {
  it("creates a profile with defaults on first visit", async () => {
    const user = randomUUID();
    const res = await get(user);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: user, isAnonymous: true, learningLang: null, dailyGoalXp: 60, timezone: "UTC" });
    expect(await userCount(user)).toBe(1);
  });

  it("creates the profile once when first requests arrive together", async () => {
    const user = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, () => get(user)));
    expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    expect(await userCount(user)).toBe(1);
  });
});

describe("PATCH /me", () => {
  it("updates only the fields sent", async () => {
    const user = randomUUID();
    await patch(user, { learningLang: "ja", timezone: "Asia/Tokyo" });
    const res = await patch(user, { dailyGoalXp: 100 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ learningLang: "ja", timezone: "Asia/Tokyo", dailyGoalXp: 100 });
    expect((await get(user)).json()).toMatchObject({ learningLang: "ja", dailyGoalXp: 100 });
  });

  it.each([
    ["an unsupported language", { learningLang: "xx" }, /learningLang/],
    ["an off-menu goal", { dailyGoalXp: 45 }, /dailyGoalXp/],
    ["a made-up time zone", { timezone: "Mars/Olympus" }, /IANA time zone/],
    ["a field it may not change", { id: randomUUID() }, /Unrecognized key/],
    ["an empty update", {}, /at least one field/],
  ])("rejects %s with a 400 naming the problem", async (_name, body, message) => {
    const res = await patch(randomUUID(), body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
    expect(res.json().error.message).toMatch(message);
  });

  it("only ever changes the caller's own profile", async () => {
    const alice = randomUUID();
    const bob = randomUUID();
    await patch(alice, { learningLang: "es" });
    await patch(bob, { learningLang: "fr" });
    expect((await get(alice)).json().learningLang).toBe("es");
  });

  it("requires a token", async () => {
    const res = await app.inject({ method: "PATCH", url: "/me", payload: { learningLang: "es" } });
    expect(res.statusCode).toBe(401);
  });
});
