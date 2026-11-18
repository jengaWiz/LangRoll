import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi } from "./helpers.js";

const { app, pool, as, stop } = await startTestApi();
afterAll(stop);

const TZ = "America/Los_Angeles";

const progress = async (user: string) =>
  (await app.inject({ method: "GET", url: "/me/progress", headers: as(user) })).json();

async function learner() {
  const user = randomUUID();
  await app.inject({ method: "PATCH", url: "/me", headers: as(user), payload: { timezone: TZ, dailyGoalXp: 30 } });
  return user;
}

// Give the learner `xp` on each of these days, counted back from their local today (0 = today).
async function activeOn(user: string, daysAgo: number[], xp = 10) {
  await pool.query(
    `insert into app.daily_progress (user_id, day, xp)
     select $1, (now() at time zone $2)::date - n, $3 from unnest($4::int[]) as n`,
    [user, TZ, xp, daysAgo],
  );
}

describe("GET /me/progress", () => {
  it("starts at zero for a new learner, dated in their timezone", async () => {
    const res = await progress(await learner());
    const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    expect(res).toEqual({
      totalXp: 0,
      today: { day: localToday, xp: 0, goalXp: 30, goalHit: false },
      streak: { current: 0, longest: 0 },
    });
  });

  it("reflects XP earned from uploaded events", async () => {
    const user = await learner();
    const event = (clipId: string) => ({
      id: randomUUID(),
      kind: "quiz_answered",
      clipId,
      occurredAt: new Date().toISOString(),
      payload: { firstTry: true },
    });
    await app.inject({ method: "POST", url: "/events", headers: as(user), payload: { events: ["es-q1", "es-q2", "es-q3"].map(event) } });
    expect(await progress(user)).toMatchObject({ totalXp: 30, today: { xp: 30, goalHit: true }, streak: { current: 1, longest: 1 } });
  });

  it("keeps a streak alive through today until the day is over", async () => {
    const user = await learner();
    await activeOn(user, [1, 2, 3]);
    expect((await progress(user)).streak).toEqual({ current: 3, longest: 3 });
  });

  it("drops the current streak after a missed day but remembers the longest", async () => {
    const user = await learner();
    await activeOn(user, [2, 3]);
    expect((await progress(user)).streak).toEqual({ current: 0, longest: 2 });
  });

  it("tells the current run apart from an older, longer one", async () => {
    const user = await learner();
    await activeOn(user, [0, 1, 10, 11, 12, 13, 14]);
    expect(await progress(user)).toMatchObject({ totalXp: 70, streak: { current: 2, longest: 5 } });
  });

  it("doesn't count days with no XP", async () => {
    const user = await learner();
    await activeOn(user, [0], 0);
    await activeOn(user, [1]);
    expect((await progress(user)).streak).toEqual({ current: 1, longest: 1 });
  });

  it("requires a token", async () => {
    expect((await app.inject({ method: "GET", url: "/me/progress" })).statusCode).toBe(401);
  });
});
