import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi } from "./helpers.js";

const { app, pool, as, stop } = await startTestApi();
afterAll(stop);

async function learnerWithData() {
  const user = randomUUID();
  await app.inject({ method: "PATCH", url: "/me", headers: as(user), payload: { learningLang: "es" } });
  const events = [
    { id: randomUUID(), kind: "quiz_answered", clipId: "es-q1", occurredAt: new Date().toISOString(), payload: { firstTry: true } },
  ];
  await app.inject({ method: "POST", url: "/events", headers: as(user), payload: { events } });
  return user;
}

const counts = async (user: string) =>
  (
    await pool.query(
      `select (select count(*) from app.users where id = $1)::int as users,
              (select count(*) from app.events where user_id = $1)::int as events,
              (select count(*) from app.cards where user_id = $1)::int as cards,
              (select count(*) from app.daily_progress where user_id = $1)::int as days`,
      [user],
    )
  ).rows[0];

describe("DELETE /me", () => {
  it("removes the profile, events, cards and progress", async () => {
    const user = await learnerWithData();
    expect(await counts(user)).toEqual({ users: 1, events: 1, cards: 1, days: 1 });
    const res = await app.inject({ method: "DELETE", url: "/me", headers: as(user) });
    expect(res.statusCode).toBe(204);
    expect(await counts(user)).toEqual({ users: 0, events: 0, cards: 0, days: 0 });
  });

  it("leaves other learners alone", async () => {
    const alice = await learnerWithData();
    const bob = await learnerWithData();
    await app.inject({ method: "DELETE", url: "/me", headers: as(alice) });
    expect(await counts(bob)).toEqual({ users: 1, events: 1, cards: 1, days: 1 });
  });

  it("is safe to repeat", async () => {
    const user = await learnerWithData();
    await app.inject({ method: "DELETE", url: "/me", headers: as(user) });
    expect((await app.inject({ method: "DELETE", url: "/me", headers: as(user) })).statusCode).toBe(204);
  });

  it("requires a token", async () => {
    expect((await app.inject({ method: "DELETE", url: "/me" })).statusCode).toBe(401);
  });
});
