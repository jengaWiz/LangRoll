// Spaced repetition: decides when a word comes back into the feed.
//
// A card looks like:
//   { id, due, interval, ease, reps, lapses }
//   due       timestamp (ms) when it's next eligible for a review clip
//   interval  days until the next review after a successful recall
//   ease      growth multiplier for the interval (starts at 2.5)
//   reps      successful recalls in a row
//   lapses    times it was forgotten

const DAY = 24 * 60 * 60 * 1000;

function newCard(id, now = Date.now()) {
  // New words come back tomorrow for their first review.
  return { id, due: now + DAY, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

// Missed or saved on purpose: put it back in the feed soon.
function dueSoon(card, now = Date.now()) {
  return { ...card, due: now + 60 * 1000 };
}

/**
 * Grade a review and return the updated card.
 *   grade: "again" (forgot), "good" (remembered), "easy" (instant)
 *
 * TODO(you): this is the heart of the "Remember" promise on the landing page.
 * The stub below uses fixed steps so the app works, but it never adapts to how
 * well someone knows a word. Things to decide:
 *   - how fast intervals grow on "good" vs "easy" (SM-2 multiplies by ease)
 *   - whether "again" resets the interval to 0 or only shrinks it
 *   - whether ease should drop on a lapse so hard words come back more often
 *   - a cap, so nothing disappears for a year in a 5-minutes-a-day app
 */
function schedule(card, grade, now = Date.now()) {
  const next = { ...card };
  if (grade === "again") {
    next.reps = 0;
    next.lapses += 1;
    next.interval = 0;
    next.due = now + 60 * 1000;
    return next;
  }
  next.reps += 1;
  next.interval = grade === "easy" ? 4 : 1;
  next.due = now + next.interval * DAY;
  return next;
}
