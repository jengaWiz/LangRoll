import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { startTestApi } from "./helpers.js";

const { app, pool, as, stop } = await startTestApi();
afterAll(stop);

const HOUR = 3600e3;

const ev = (kind: string, payload: object = {}, clipId = "es-v1") => ({
  id: randomUUID(),
  kind,
  clipId,
  occurredAt: new Date().toISOString(),
  payload,
});

const upload = (user: string, events: unknown[]) =>
  app.inject({ method: "POST", url: "/events", headers: as(user), payload: { events } });

async function card(user: string, clipId = "es-v1") {
  const { rows } = await pool.query(
    "select due_at, interval_days, ease, reps, lapses from app.cards where user_id = $1 and clip_id = $2",
    [user, clipId],
  );
  return rows[0] as { due_at: Date; interval_days: number; ease: number; reps: number; lapses: number } | undefined;
}

const hoursUntil = (d: Date) => (d.getTime() - Date.now()) / HOUR;
const makeDue = (user: string) => pool.query("update app.cards set due_at = now() - interval '1 minute' where user_id = $1", [user]);

describe("review cards from events", () => {
  it("adds a newly seen word for tomorrow", async () => {
    const user = randomUUID();
    await upload(user, [ev("clip_viewed")]);
    expect(hoursUntil((await card(user))!.due_at)).toBeCloseTo(24, 0);
  });

  it("brings a missed quiz back within minutes", async () => {
    const user = randomUUID();
    await upload(user, [ev("quiz_answered", { firstTry: false }, "es-q1")]);
    expect(hoursUntil((await card(user, "es-q1"))!.due_at)).toBeLessThan(0.1);
  });

  it("reschedules a due card when it's reviewed", async () => {
    const user = randomUUID();
    await upload(user, [ev("clip_viewed")]);
    await makeDue(user);
    await upload(user, [ev("review_graded", { grade: "good" })]);
    const c = (await card(user))!;
    expect(c).toMatchObject({ reps: 1, interval_days: 1 });
    expect(hoursUntil(c.due_at)).toBeCloseTo(24, 0);
  });

  it("applies a retried review only once", async () => {
    const user = randomUUID();
    await upload(user, [ev("clip_viewed")]);
    await makeDue(user);
    const review = [ev("review_graded", { grade: "again" })];
    await upload(user, review);
    await upload(user, review);
    expect((await card(user))!.lapses).toBe(1);
  });

  it("doesn't push a card out when it's graded before it's due", async () => {
    const user = randomUUID();
    await upload(user, [ev("clip_viewed")]);
    const before = (await card(user))!;
    await upload(user, [ev("review_graded", { grade: "easy" }), ev("review_graded", { grade: "easy" })]);
    expect(await card(user)).toEqual(before);
  });

  // ease is stored as a 4-byte real, where 1.3 is 1.2999999…; the word must still save once it
  // reaches the floor, or every later upload from that learner is refused
  it("keeps saving a word forgotten so often its ease hits the floor", async () => {
    const user = randomUUID();
    await upload(user, [ev("clip_viewed")]);
    for (let i = 0; i < 7; i++) {
      await makeDue(user);
      const res = await upload(user, [ev("review_graded", { grade: "again" })]);
      expect(res.statusCode, `forget #${i + 1}`).toBe(200);
    }
    const c = (await card(user))!;
    expect(c.lapses).toBe(7);
    expect(c.ease).toBeCloseTo(1.3);
  });

  it("doesn't make cards for duels", async () => {
    const user = randomUUID();
    await upload(user, [ev("duel_finished", { won: true }, "es-duel")]);
    expect(await card(user, "es-duel")).toBeUndefined();
  });
});
