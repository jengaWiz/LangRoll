import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi } from "./helpers.js";

const { app, pool, as, stop } = await startTestApi();
afterAll(stop);

const ev = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  kind: "quiz_answered",
  clipId: "es-q1",
  occurredAt: new Date().toISOString(),
  payload: { firstTry: true },
  ...over,
});

const upload = (user: string, events: unknown[]) =>
  app.inject({ method: "POST", url: "/events", headers: as(user), payload: { events } });

const stored = async (user: string) =>
  (await pool.query("select id, kind, clip_id, payload, xp_awarded from app.events where user_id = $1", [user])).rows;

describe("POST /events", () => {
  it("stores a batch and reports what was accepted", async () => {
    const user = randomUUID();
    const batch = [ev(), ev({ kind: "clip_viewed", clipId: "es-v1", payload: {} })];
    const res = await upload(user, batch);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: batch.map((e) => e.id), duplicates: [], rejected: [] });
    expect(await stored(user)).toHaveLength(2);
  });

  it("stores a retried batch only once", async () => {
    const user = randomUUID();
    const batch = [ev(), ev()];
    await upload(user, batch);
    const retry = await upload(user, [...batch, batch[0]]);
    expect(retry.json()).toEqual({ accepted: [], duplicates: batch.map((e) => e.id), rejected: [] });
    expect(await stored(user)).toHaveLength(2);
  });

  it("never takes XP from the client", async () => {
    const user = randomUUID();
    const res = await upload(user, [ev({ xp: 9999 })]);
    expect(res.statusCode).toBe(400);
    expect(await stored(user)).toHaveLength(0);
  });

  it("refuses stale and future events one by one without blocking the rest", async () => {
    const user = randomUUID();
    const ok = ev();
    const old = ev({ occurredAt: new Date(Date.now() - 31 * 864e5).toISOString() });
    const future = ev({ occurredAt: new Date(Date.now() + 3600e3).toISOString() });
    const res = await upload(user, [old, ok, future]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accepted: [ok.id],
      duplicates: [],
      rejected: [
        { id: old.id, reason: "too_old" },
        { id: future.id, reason: "occurred_in_future" },
      ],
    });
  });

  it.each([
    ["an unknown kind", { kind: "xp_granted" }],
    ["a payload for the wrong kind", { payload: { score: 100 } }],
    ["an out-of-range speech score", { kind: "speech_scored", payload: { score: 250 } }],
    ["an extra payload field", { payload: { firstTry: true, bonus: 50 } }],
    ["a malformed clip id", { clipId: "../../etc/passwd" }],
    ["a non-UUID id", { id: "1" }],
    ["a time without a zone", { occurredAt: "2026-11-17T10:00:00" }],
  ])("rejects the whole batch for %s", async (_name, over) => {
    const user = randomUUID();
    const res = await upload(user, [ev(), ev(over)]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
    expect(await stored(user)).toHaveLength(0);
  });

  it("limits batch size", async () => {
    const res = await upload(randomUUID(), Array.from({ length: 101 }, () => ev()));
    expect(res.statusCode).toBe(400);
    expect((await upload(randomUUID(), [])).statusCode).toBe(400);
  });

  it("keeps each user's events separate, even with the same ids", async () => {
    const e = ev();
    const alice = randomUUID();
    const bob = randomUUID();
    await upload(alice, [e]);
    expect((await upload(bob, [e])).json().accepted).toEqual([e.id]);
    expect(await stored(alice)).toHaveLength(1);
  });

  it("requires a token", async () => {
    const res = await app.inject({ method: "POST", url: "/events", payload: { events: [ev()] } });
    expect(res.statusCode).toBe(401);
  });
});
