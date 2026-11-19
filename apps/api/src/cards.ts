import type { Db } from "./db.js";
import { applyEvent, type Card } from "./srs.js";

interface Row {
  clip_id: string;
  due_at: Date;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
}

/**
 * Updates the learner's review cards from newly stored events, in order. Runs inside the
 * upload's transaction, which already holds the learner's lock.
 */
export async function updateCards(
  tx: Db,
  userId: string,
  events: { kind: string; clipId: string; payload: Record<string, unknown> }[],
  now = new Date(),
): Promise<void> {
  const clipIds = [...new Set(events.map((e) => e.clipId))];
  const { rows } = await tx.query<Row>(
    `select clip_id, due_at, interval_days, ease, reps, lapses from app.cards
      where user_id = $1 and clip_id = any($2::text[])`,
    [userId, clipIds],
  );
  const cards = new Map<string, Card>(
    rows.map((r) => [r.clip_id, { dueAt: r.due_at, intervalDays: r.interval_days, ease: r.ease, reps: r.reps, lapses: r.lapses }]),
  );

  const changed = new Map<string, Card>();
  for (const e of events) {
    const next = applyEvent(cards.get(e.clipId) ?? null, e, now);
    if (next) {
      cards.set(e.clipId, next);
      changed.set(e.clipId, next);
    }
  }
  if (!changed.size) return;

  const list = [...changed];
  await tx.query(
    `insert into app.cards as c (user_id, clip_id, due_at, interval_days, ease, reps, lapses, updated_at)
     select $1, v.clip_id, v.due_at, v.interval_days, v.ease, v.reps, v.lapses, now()
       from unnest($2::text[], $3::timestamptz[], $4::real[], $5::real[], $6::int[], $7::int[])
            as v(clip_id, due_at, interval_days, ease, reps, lapses)
     on conflict (user_id, clip_id) do update
       set due_at = excluded.due_at, interval_days = excluded.interval_days, ease = excluded.ease,
           reps = excluded.reps, lapses = excluded.lapses, updated_at = now()`,
    [
      userId,
      list.map(([id]) => id),
      list.map(([, c]) => c.dueAt),
      list.map(([, c]) => c.intervalDays),
      list.map(([, c]) => c.ease),
      list.map(([, c]) => c.reps),
      list.map(([, c]) => c.lapses),
    ],
  );
}

export interface DueList {
  due: { clipId: string; dueAt: string }[];
  dueCount: number;
  deckSize: number;
}

const DUE_LIMIT = 100;

/**
 * Cards due for review now, oldest first, for one language. Clip ids start with their
 * language code ("es-v1"), which is how cards are matched to a language until content lives
 * in the database.
 */
export async function dueReviews(db: Db, userId: string, lang: string, now = new Date()): Promise<DueList> {
  const prefix = `${lang}-`;
  const [due, counts] = await Promise.all([
    db.query<{ clip_id: string; due_at: Date }>(
      `select clip_id, due_at from app.cards
        where user_id = $1 and starts_with(clip_id, $2) and due_at <= $3
        order by due_at limit ${DUE_LIMIT}`,
      [userId, prefix, now],
    ),
    db.query<{ due_count: string; deck_size: string }>(
      `select count(*) filter (where due_at <= $3) as due_count, count(*) as deck_size
         from app.cards where user_id = $1 and starts_with(clip_id, $2)`,
      [userId, prefix, now],
    ),
  ]);
  return {
    due: due.rows.map((r) => ({ clipId: r.clip_id, dueAt: r.due_at.toISOString() })),
    dueCount: Number(counts.rows[0]!.due_count),
    deckSize: Number(counts.rows[0]!.deck_size),
  };
}

export interface DeckCard {
  clipId: string;
  dueAt: string;
  intervalDays: number;
  reps: number;
  lapses: number;
}

// Bounded by the amount of content in a language; this guards against surprises.
const DECK_LIMIT = 2000;

/** Every card in one language, soonest due first, so the app can mirror the server's deck. */
export async function deck(db: Db, userId: string, lang: string): Promise<DeckCard[]> {
  const { rows } = await db.query<Row>(
    `select clip_id, due_at, interval_days, ease, reps, lapses from app.cards
      where user_id = $1 and starts_with(clip_id, $2)
      order by due_at limit ${DECK_LIMIT}`,
    [userId, `${lang}-`],
  );
  return rows.map((r) => ({
    clipId: r.clip_id,
    dueAt: r.due_at.toISOString(),
    intervalDays: r.interval_days,
    reps: r.reps,
    lapses: r.lapses,
  }));
}
