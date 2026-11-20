import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi } from "./helpers.js";

const { app, pool, as, stop } = await startTestApi();
afterAll(stop);

const send = (user: string, payload: object) => app.inject({ method: "POST", url: "/feedback", headers: as(user), payload });
const stored = async (user: string) =>
  (await pool.query("select message, app_version, platform from app.feedback where user_id = $1", [user])).rows;

describe("POST /feedback", () => {
  it("stores a tester's note with the app version and device", async () => {
    const user = randomUUID();
    const res = await send(user, { message: "  the mic hint overlaps the score on my phone  ", appVersion: "langroll-v12", platform: "iPhone Safari" });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await stored(user)).toEqual([
      { message: "the mic hint overlaps the score on my phone", app_version: "langroll-v12", platform: "iPhone Safari" },
    ]);
  });

  it.each([
    ["an empty note", { message: "   " }, /can't be empty/],
    ["a note over 2000 characters", { message: "x".repeat(2001) }, /2000 characters/],
    ["an unexpected field", { message: "hi", userId: randomUUID() }, /Unrecognized key/],
  ])("rejects %s", async (_name, payload, message) => {
    const user = randomUUID();
    const res = await send(user, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(message);
    expect(await stored(user)).toEqual([]);
  });

  it("is deleted along with the rest of the learner's data", async () => {
    const user = randomUUID();
    await send(user, { message: "love it" });
    await app.inject({ method: "DELETE", url: "/me", headers: as(user) });
    expect(await stored(user)).toEqual([]);
  });

  it("requires a token", async () => {
    expect((await app.inject({ method: "POST", url: "/feedback", payload: { message: "hi" } })).statusCode).toBe(401);
  });

  it("allows 10 notes an hour per client", async () => {
    const user = randomUUID();
    // Last on purpose: limits are per client IP, and every test here shares one.
    const results = await Promise.all(Array.from({ length: 12 }, () => send(user, { message: "again" })));
    expect(results.some((r) => r.statusCode === 429)).toBe(true);
    expect(results.find((r) => r.statusCode === 429)!.json().error.code).toBe("rate_limited");
  });
});
