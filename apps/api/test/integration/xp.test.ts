import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi } from "./helpers.js";

const { app, pool, as, stop } = await startTestApi();
afterAll(stop);

const quiz = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  kind: "quiz_answered",
  clipId: "es-q1",
  occurredAt: new Date().toISOString(),
  payload: { firstTry: true },
  ...over,
});

const upload = (user: string, events: unknown[]) =>
  app.inject({ method: "POST", url: "/events", headers: as(user), payload: { events } });

const progress = async (user: string) =>
  (await pool.query("select day::text, xp, goal_hit from app.daily_progress where user_id = $1 order by day", [user])).rows;

const totalXp = async (user: string) =>
  Number((await pool.query("select coalesce(sum(xp_awarded), 0) as n from app.events where user_id = $1", [user])).rows[0].n);

const setProfile = (user: string, body: object) => app.inject({ method: "PATCH", url: "/me", headers: as(user), payload: body });

describe("XP from uploaded events", () => {
  it("awards XP and adds it to the day's progress", async () => {
    const user = randomUUID();
    await upload(user, [quiz(), quiz({ kind: "card_flipped", clipId: "es-f1", payload: {} })]);
    expect(await totalXp(user)).toBe(15);
    expect(await progress(user)).toEqual([expect.objectContaining({ xp: 15, goal_hit: false })]);
  });

  it("doesn't re-award a retried batch or a repeat with a new id", async () => {
    const user = randomUUID();
    const batch = [quiz()];
    await upload(user, batch);
    await upload(user, batch);
    await upload(user, [quiz()]);
    expect(await totalXp(user)).toBe(10);
    expect((await progress(user))[0].xp).toBe(10);
  });

  it("awards once when many uploads for the same clip arrive together", async () => {
    const user = randomUUID();
    await setProfile(user, { dailyGoalXp: 30 }); // create the user up front
    await Promise.all(Array.from({ length: 6 }, () => upload(user, [quiz()])));
    expect(await totalXp(user)).toBe(10);
    expect((await progress(user))[0].xp).toBe(10);
  });

  // Uploads finish too fast to overlap reliably in a test, so check the lock that prevents
  // double awards directly: an upload must wait while another holds the learner's row.
  it("scores one upload at a time per learner", async () => {
    const user = randomUUID();
    await setProfile(user, { dailyGoalXp: 30 });
    const other = await pool.connect();
    try {
      await other.query("begin");
      // NO KEY UPDATE: the events foreign key check doesn't wait for it, but the upload's own
      // FOR UPDATE does. So this passes only if storeEvents really locks the learner.
      await other.query("select 1 from app.users where id = $1 for no key update", [user]);
      let done = false;
      const pending = upload(user, [quiz()]).then((res) => {
        done = true;
        return res;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(done, "upload should wait for the learner's lock").toBe(false);
      await other.query("commit");
      expect((await pending).statusCode).toBe(200);
    } finally {
      other.release();
    }
  });

  it("marks the daily goal as hit once enough XP is earned", async () => {
    const user = randomUUID();
    await setProfile(user, { dailyGoalXp: 30 });
    await upload(user, [quiz(), quiz({ clipId: "es-q2" })]);
    expect((await progress(user))[0]).toMatchObject({ xp: 20, goal_hit: false });
    await upload(user, [quiz({ clipId: "es-q3" })]);
    expect((await progress(user))[0]).toMatchObject({ xp: 30, goal_hit: true });
  });

  it("counts the day in the learner's own timezone", async () => {
    const user = randomUUID();
    await setProfile(user, { timezone: "Pacific/Kiritimati" }); // UTC+14
    const now = new Date();
    await upload(user, [quiz({ occurredAt: now.toISOString() })]);
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(now); // YYYY-MM-DD
    expect((await progress(user))[0].day).toBe(local);
  });

  it("counts an offline event on its day, but no more than 36 hours back", async () => {
    const user = randomUUID();
    const yesterday = new Date(Date.now() - 24 * 3600e3);
    const lastWeek = new Date(Date.now() - 7 * 24 * 3600e3);
    await upload(user, [quiz({ occurredAt: yesterday.toISOString() }), quiz({ clipId: "es-q2", occurredAt: lastWeek.toISOString() })]);
    const { rows } = await pool.query<{ day: string; occurred: string }>(
      "select day::text, occurred_at::date::text as occurred from app.events where user_id = $1 order by occurred_at desc",
      [user],
    );
    const utcDay = (d: Date) => d.toISOString().slice(0, 10);
    expect(rows[0]!.day).toBe(utcDay(yesterday));
    const earliest = utcDay(new Date(Date.now() - 36 * 3600e3));
    expect(rows[1]!.day >= earliest).toBe(true);
  });
});
