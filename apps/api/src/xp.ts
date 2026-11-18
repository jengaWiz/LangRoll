// How much XP each kind of event earns. Mirrors the amounts the app has always shown,
// but is decided here, so editing the app can't change them.
const RULES: Record<string, (payload: Record<string, unknown>) => number> = {
  quiz_answered: (p) => (p.firstTry ? 10 : 5),
  speech_scored: (p) => ((p.score as number) >= 85 ? 15 : 8),
  card_flipped: () => 5,
  review_graded: (p) => (p.grade === "again" ? 2 : 5),
  duel_finished: (p) => (p.won ? 25 : 0),
  clip_viewed: () => 0,
  clip_saved: () => 0,
};

export interface ScoredEvent {
  id: string;
  kind: string;
  clipId: string;
  payload: Record<string, unknown>;
  day: string; // YYYY-MM-DD in the learner's timezone
}

// The same kind of action on the same clip earns XP once per day, however many times it is
// repeated or re-sent with new ids.
export const awardKey = (e: { kind: string; clipId: string; day: string }) => `${e.kind}|${e.clipId}|${e.day}`;

/**
 * XP for each newly stored event, in order. `alreadyEarned` holds the award keys earned by
 * earlier events, so only the first matching event of a day scores.
 */
export function awardXp(events: ScoredEvent[], alreadyEarned: Set<string>): Map<string, number> {
  const earned = new Set(alreadyEarned);
  const out = new Map<string, number>();
  for (const e of events) {
    const xp = RULES[e.kind]?.(e.payload) ?? 0;
    const key = awardKey(e);
    if (xp > 0 && !earned.has(key)) {
      earned.add(key);
      out.set(e.id, xp);
    } else {
      out.set(e.id, 0);
    }
  }
  return out;
}
