// Spaced repetition: when each word comes back for review. A variant of SM-2 (the algorithm
// behind Anki), tuned for a few minutes a day. Pure functions, so the rules are easy to test.

export interface Card {
  dueAt: Date;
  intervalDays: number; // gap until the next review after a successful recall
  ease: number; // how fast the gap grows, 1.3 (hard word) to 3.0 (easy word)
  reps: number; // successful recalls in a row
  lapses: number; // times it was forgotten
}

export type Grade = "again" | "good" | "easy";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
// Nothing disappears for longer than this in a 5-minutes-a-day app.
export const MAX_INTERVAL_DAYS = 60;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
// Two decimals, so float error from the database's 4-byte real column can't build up.
const easeOf = (n: number) => Math.round(clamp(n, MIN_EASE, MAX_EASE) * 100) / 100;

// A word seen for the first time comes back tomorrow.
export function newCard(now: Date): Card {
  return { dueAt: new Date(now.getTime() + DAY), intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
}

// Missed in a quiz, or saved on purpose: bring it back into the feed soon.
export function dueSoon(card: Card, now: Date): Card {
  const soon = new Date(now.getTime() + MINUTE);
  return card.dueAt > soon ? { ...card, dueAt: soon } : card;
}

/** Applies a review grade and returns the updated card. */
export function schedule(card: Card, grade: Grade, now: Date): Card {
  if (grade === "again") {
    // Forgotten: start the run over, and make the word come back more often from now on.
    return {
      dueAt: new Date(now.getTime() + 10 * MINUTE),
      intervalDays: 0,
      ease: easeOf(card.ease - 0.2),
      reps: 0,
      lapses: card.lapses + 1,
    };
  }
  // Grading a card before it's due doesn't push it further out, so repeatedly tapping "easy"
  // can't skip reviews.
  if (card.dueAt > now) return card;

  const reps = card.reps + 1;
  const ease = grade === "easy" ? easeOf(card.ease + 0.15) : card.ease;
  let interval: number;
  if (reps === 1) interval = grade === "easy" ? 3 : 1;
  else if (reps === 2) interval = grade === "easy" ? 6 : 3;
  else interval = Math.round(card.intervalDays * ease * (grade === "easy" ? 1.3 : 1));
  interval = clamp(interval, 1, MAX_INTERVAL_DAYS);
  return { dueAt: new Date(now.getTime() + interval * DAY), intervalDays: interval, ease, reps, lapses: card.lapses };
}

/**
 * How an event changes a clip's card, mirroring the app: viewing or answering a clip adds it,
 * a missed quiz or a save brings it back soon, and a review grade reschedules it.
 * Returns null when the event doesn't touch the card.
 */
export function applyEvent(
  card: Card | null,
  event: { kind: string; payload: Record<string, unknown> },
  now: Date,
): Card | null {
  const existing = card ?? newCard(now);
  switch (event.kind) {
    case "clip_viewed":
    case "card_flipped":
    case "speech_scored":
      return card ? null : existing;
    case "quiz_answered":
      return event.payload.firstTry ? (card ? null : existing) : dueSoon(existing, now);
    case "clip_saved":
      return event.payload.saved ? dueSoon(existing, now) : null;
    case "review_graded":
      return schedule(existing, event.payload.grade as Grade, now);
    default:
      return null;
  }
}
