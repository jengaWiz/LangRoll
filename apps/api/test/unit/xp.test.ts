import { describe, expect, it } from "vitest";
import { awardKey, awardXp, type ScoredEvent } from "../../src/xp.js";

let n = 0;
const ev = (kind: string, payload: Record<string, unknown> = {}, over: Partial<ScoredEvent> = {}): ScoredEvent => ({
  id: `e${++n}`,
  kind,
  clipId: "es-q1",
  payload,
  day: "2026-11-18",
  ...over,
});

const xpOf = (events: ScoredEvent[], prior = new Set<string>()) => [...awardXp(events, prior).values()];

describe("awardXp", () => {
  it("uses the app's amounts", () => {
    expect(xpOf([ev("quiz_answered", { firstTry: true })])).toEqual([10]);
    expect(xpOf([ev("quiz_answered", { firstTry: false })])).toEqual([5]);
    expect(xpOf([ev("speech_scored", { score: 85 })])).toEqual([15]);
    expect(xpOf([ev("speech_scored", { score: 84 })])).toEqual([8]);
    expect(xpOf([ev("speech_scored", { score: 60 })])).toEqual([8]);
    expect(xpOf([ev("speech_scored", { score: 59 })])).toEqual([0]);
    expect(xpOf([ev("card_flipped")])).toEqual([5]);
    expect(xpOf([ev("review_graded", { grade: "good" })])).toEqual([5]);
    expect(xpOf([ev("review_graded", { grade: "again" })])).toEqual([2]);
    expect(xpOf([ev("duel_finished", { won: true })])).toEqual([25]);
    expect(xpOf([ev("duel_finished", { won: false }), ev("clip_viewed"), ev("clip_saved", { saved: true })])).toEqual([0, 0, 0]);
  });

  it("lets a failed speaking attempt be followed by a scoring one the same day", () => {
    expect(xpOf([ev("speech_scored", { score: 30 }), ev("speech_scored", { score: 90 })])).toEqual([0, 15]);
  });

  it("awards a clip's action once per day, however often it's repeated", () => {
    expect(xpOf([ev("quiz_answered", { firstTry: true }), ev("quiz_answered", { firstTry: true })])).toEqual([10, 0]);
  });

  it("awards it again on another day or for another clip", () => {
    const events = [
      ev("quiz_answered", { firstTry: true }),
      ev("quiz_answered", { firstTry: true }, { day: "2026-11-19" }),
      ev("quiz_answered", { firstTry: true }, { clipId: "es-q2" }),
      ev("speech_scored", { score: 90 }),
    ];
    expect(xpOf(events)).toEqual([10, 10, 10, 15]);
  });

  it("respects awards from earlier uploads", () => {
    const prior = new Set([awardKey({ kind: "card_flipped", clipId: "es-q1", day: "2026-11-18" })]);
    expect(xpOf([ev("card_flipped")], prior)).toEqual([0]);
  });

  it("ignores kinds it doesn't know", () => {
    expect(xpOf([ev("made_up_kind")])).toEqual([0]);
  });
});
