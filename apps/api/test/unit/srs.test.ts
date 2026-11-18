import { describe, expect, it } from "vitest";
import { applyEvent, MAX_INTERVAL_DAYS, newCard, schedule, type Card } from "../../src/srs.js";

const now = new Date("2026-11-18T12:00:00Z");
const DAY = 864e5;
const later = (days: number) => new Date(now.getTime() + days * DAY);
const daysUntil = (c: Card, from = now) => Math.round((c.dueAt.getTime() - from.getTime()) / DAY);

// Review a card on the day it's due, `grades` in a row.
function run(grades: ("again" | "good" | "easy")[]) {
  let card = { ...newCard(now), dueAt: now };
  let t = now;
  const gaps: number[] = [];
  for (const g of grades) {
    card = schedule(card, g, t);
    gaps.push(Math.round((card.dueAt.getTime() - t.getTime()) / DAY));
    t = card.dueAt;
  }
  return { card, gaps };
}

describe("schedule", () => {
  it("spaces good recalls out: 1, 3, then growing by ease", () => {
    expect(run(["good", "good", "good", "good"]).gaps).toEqual([1, 3, 8, 20]);
  });

  it("grows faster and gets easier on easy", () => {
    const { card, gaps } = run(["easy", "easy", "easy"]);
    expect(gaps[0]).toBe(3);
    expect(gaps[1]).toBe(6);
    expect(gaps[2]).toBeGreaterThan(20);
    expect(card.ease).toBeCloseTo(2.95);
  });

  it("brings a forgotten word back in 10 minutes and makes it harder", () => {
    const { card } = run(["good", "good", "again"]);
    expect(card.dueAt.getTime() - later(4).getTime()).toBe(10 * 60_000);
    expect(card).toMatchObject({ reps: 0, lapses: 1, intervalDays: 0 });
    expect(card.ease).toBeCloseTo(2.3);
  });

  it("keeps ease between 1.3 and 3.0", () => {
    expect(run(Array(10).fill("again")).card.ease).toBeCloseTo(1.3);
    expect(run(Array(10).fill("easy")).card.ease).toBeCloseTo(3.0);
  });

  it(`never schedules more than ${MAX_INTERVAL_DAYS} days out`, () => {
    expect(Math.max(...run(Array(12).fill("easy")).gaps)).toBe(MAX_INTERVAL_DAYS);
  });

  it("ignores good or easy on a card that isn't due yet", () => {
    const card = schedule({ ...newCard(now), dueAt: now }, "good", now); // due tomorrow
    expect(schedule(card, "easy", now)).toBe(card);
    expect(schedule(card, "again", now).lapses).toBe(1); // forgetting always counts
  });
});

describe("applyEvent", () => {
  it("adds a newly seen word for tomorrow, and leaves known ones alone", () => {
    const card = applyEvent(null, { kind: "clip_viewed", payload: {} }, now)!;
    expect(daysUntil(card)).toBe(1);
    expect(applyEvent(card, { kind: "clip_viewed", payload: {} }, now)).toBeNull();
  });

  it("brings a missed quiz or a saved clip back soon", () => {
    const card = newCard(now);
    expect(applyEvent(card, { kind: "quiz_answered", payload: { firstTry: false } }, now)!.dueAt.getTime() - now.getTime()).toBe(60_000);
    expect(applyEvent(card, { kind: "clip_saved", payload: { saved: true } }, now)!.dueAt.getTime() - now.getTime()).toBe(60_000);
    expect(applyEvent(card, { kind: "clip_saved", payload: { saved: false } }, now)).toBeNull();
  });

  it("reschedules on a review grade", () => {
    const due = { ...newCard(now), dueAt: now };
    expect(daysUntil(applyEvent(due, { kind: "review_graded", payload: { grade: "good" } }, now)!)).toBe(1);
  });

  it("ignores duels and unknown kinds", () => {
    expect(applyEvent(null, { kind: "duel_finished", payload: { won: true } }, now)).toBeNull();
  });
});
