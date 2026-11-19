import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi } from "./helpers.js";

const { app, pool, as, stop } = await startTestApi();
afterAll(stop);

const reviews = async (user: string) =>
  (await app.inject({ method: "GET", url: "/me/reviews", headers: as(user) })).json();

// Cards due `minutes` from now (negative = overdue).
async function cards(user: string, list: [clipId: string, minutes: number][]) {
  await pool.query(
    `insert into app.cards (user_id, clip_id, due_at)
     select $1, c, now() + make_interval(mins => m) from unnest($2::text[], $3::int[]) as v(c, m)`,
    [user, list.map(([c]) => c), list.map(([, m]) => m)],
  );
}

async function learner(lang?: string) {
  const user = randomUUID();
  await app.inject({ method: "PATCH", url: "/me", headers: as(user), payload: lang ? { learningLang: lang } : { dailyGoalXp: 60 } });
  return user;
}

describe("GET /me/reviews", () => {
  it("lists due cards oldest first, with counts", async () => {
    const user = await learner("es");
    await cards(user, [
      ["es-v1", -5],
      ["es-q1", -60],
      ["es-f1", 600], // not due yet
    ]);
    const res = await reviews(user);
    expect(res.due.map((d: { clipId: string }) => d.clipId)).toEqual(["es-q1", "es-v1"]);
    expect(res).toMatchObject({ dueCount: 2, deckSize: 3 });
  });

  it("only shows the learner's current language", async () => {
    const user = await learner("fr");
    await cards(user, [
      ["fr-v1", -5],
      ["es-v1", -5],
    ]);
    expect(await reviews(user)).toMatchObject({ dueCount: 1, deckSize: 1, due: [{ clipId: "fr-v1" }] });
  });

  it("is empty until a language is picked", async () => {
    const user = await learner();
    await cards(user, [["es-v1", -5]]);
    expect(await reviews(user)).toEqual({ due: [], dueCount: 0, deckSize: 0 });
  });

  it("caps the list at 100 but counts everything due", async () => {
    const user = await learner("es");
    await cards(user, Array.from({ length: 120 }, (_, i) => [`es-x${i}`, -1 - i] as [string, number]));
    const res = await reviews(user);
    expect(res.due).toHaveLength(100);
    expect(res.dueCount).toBe(120);
  });

  it("never shows another learner's cards", async () => {
    const alice = await learner("es");
    const bob = await learner("es");
    await cards(alice, [["es-v1", -5]]);
    expect((await reviews(bob)).dueCount).toBe(0);
  });

  it("requires a token", async () => {
    expect((await app.inject({ method: "GET", url: "/me/reviews" })).statusCode).toBe(401);
  });
});

describe("GET /me/cards", () => {
  const deckOf = async (user: string) => (await app.inject({ method: "GET", url: "/me/cards", headers: as(user) })).json().cards;

  it("returns every card in the current language, soonest first, due or not", async () => {
    const user = await learner("ja");
    await cards(user, [
      ["ja-v1", 600],
      ["ja-q1", -5],
      ["es-v1", -5],
    ]);
    const list = await deckOf(user);
    expect(list.map((c: { clipId: string }) => c.clipId)).toEqual(["ja-q1", "ja-v1"]);
    expect(list[0]).toEqual({ clipId: "ja-q1", dueAt: expect.any(String), intervalDays: 0, reps: 0, lapses: 0 });
  });

  it("is empty until a language is picked, and private to each learner", async () => {
    const user = await learner();
    await cards(user, [["es-v1", -5]]);
    expect(await deckOf(user)).toEqual([]);
    expect(await deckOf(await learner("es"))).toEqual([]);
  });
});
