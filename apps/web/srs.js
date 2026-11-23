// Spaced repetition: when each word comes back for review. The same rules as the server's
// (apps/api/src/srs.ts, a variant of SM-2), so "back in 3 days" here is what the server
// schedules, and a review done offline lands where it will after the next sync.
// tests/srs.spec.js checks the two stay in step.
//
// A card looks like:
//   { id, due, interval, ease, reps, lapses }
//   due       timestamp (ms) when it's next eligible for a review clip
//   interval  days until the next review after a successful recall
//   ease      how fast the gap grows, 1.3 (hard word) to 3.0 (easy word)
//   reps      successful recalls in a row
//   lapses    times it was forgotten

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
// Nothing disappears for longer than this in a 5-minutes-a-day app.
const MAX_INTERVAL_DAYS = 60;

// Two decimals, like the server, so the two never drift apart.
const easeOf = (n) => Math.round(Math.min(MAX_EASE, Math.max(MIN_EASE, n)) * 100) / 100;

// A word seen for the first time comes back tomorrow.
function newCard(id, now = Date.now()) {
  return { id, due: now + DAY, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

// Missed in a quiz, or saved on purpose: bring it back into the feed soon. A word that's
// already due stays due rather than being pushed a minute later.
function dueSoon(card, now = Date.now()) {
  const soon = now + MINUTE;
  return card.due > soon ? { ...card, due: soon } : card;
}

/**
 * Grade a review and return the updated card.
 *   grade: "again" (forgot), "good" (remembered), "easy" (instant)
 */
function schedule(card, grade, now = Date.now()) {
  if (grade === "again") {
    // Forgotten: start the run over, and bring the word back more often from now on.
    return { ...card, due: now + 10 * MINUTE, interval: 0, ease: easeOf(card.ease - 0.2), reps: 0, lapses: card.lapses + 1 };
  }
  // Grading a card before it's due doesn't push it further out, so tapping "easy" can't skip reviews.
  if (card.due > now) return card;

  const reps = card.reps + 1;
  const ease = grade === "easy" ? easeOf(card.ease + 0.15) : card.ease;
  let interval;
  if (reps === 1) interval = grade === "easy" ? 3 : 1;
  else if (reps === 2) interval = grade === "easy" ? 6 : 3;
  else interval = Math.round(card.interval * ease * (grade === "easy" ? 1.3 : 1));
  interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval));
  return { ...card, due: now + interval * DAY, interval, ease, reps };
}
