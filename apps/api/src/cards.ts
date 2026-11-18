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
