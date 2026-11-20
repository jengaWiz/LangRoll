import { z } from "zod";
import type { Db } from "./db.js";

// Languages with content in the app. Keep in sync with apps/web/content.js until content moves
// into the database.
// Launch languages: Spanish, French and Japanese.
export const LANGUAGES = ["es", "fr", "ja"] as const;
export const DAILY_GOALS = [30, 60, 100] as const;

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// What a learner may change about themselves. `.strict()` rejects unknown fields, so a client
// can't slip in columns like `id` or `created_at`.
export const ProfileUpdate = z
  .object({
    learningLang: z.enum(LANGUAGES),
    dailyGoalXp: z.union(DAILY_GOALS.map((g) => z.literal(g))),
    timezone: z.string().max(64).refine(isTimeZone, "must be an IANA time zone, e.g. America/Los_Angeles"),
  })
  .partial()
  .strict()
  .refine((u) => Object.keys(u).length > 0, "send at least one field to change");

export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export interface Profile {
  id: string;
  learningLang: string | null;
  dailyGoalXp: number;
  timezone: string;
  createdAt: string;
}

interface Row {
  id: string;
  learning_lang: string | null;
  daily_goal_xp: number;
  timezone: string;
  created_at: Date;
}

const COLUMNS = "id, learning_lang, daily_goal_xp, timezone, created_at";

const toProfile = (r: Row): Profile => ({
  id: r.id,
  learningLang: r.learning_lang,
  dailyGoalXp: r.daily_goal_xp,
  timezone: r.timezone,
  createdAt: r.created_at.toISOString(),
});

const select = (db: Db, id: string) => db.query<Row>(`select ${COLUMNS} from app.users where id = $1`, [id]);

// Returns the learner's profile, creating it the first time we see their account.
// Safe to call concurrently. The insert is a no-op if another request won the race, and the
// re-select is a new statement, so it sees that request's committed row.
export async function ensureProfile(db: Db, id: string): Promise<Profile> {
  const existing = await select(db, id);
  if (existing.rows[0]) return toProfile(existing.rows[0]);
  const created = await db.query<Row>(
    `insert into app.users (id) values ($1) on conflict (id) do nothing returning ${COLUMNS}`,
    [id],
  );
  const row = created.rows[0] ?? (await select(db, id)).rows[0];
  if (!row) throw new Error(`user ${id} vanished while being created`);
  return toProfile(row);
}

export async function updateProfile(db: Db, id: string, update: ProfileUpdate): Promise<Profile> {
  await ensureProfile(db, id);
  // Fixed column list with coalesce: no SQL is built from client input.
  const { rows } = await db.query<Row>(
    `update app.users
        set learning_lang = coalesce($2, learning_lang),
            daily_goal_xp = coalesce($3, daily_goal_xp),
            timezone      = coalesce($4, timezone),
            updated_at    = now()
      where id = $1
      returning ${COLUMNS}`,
    [id, update.learningLang ?? null, update.dailyGoalXp ?? null, update.timezone ?? null],
  );
  return toProfile(rows[0]!);
}

/**
 * Deletes everything we store about a learner: the profile row, and through it (on delete
 * cascade) their events, cards and daily progress. Returns whether there was anything to delete.
 */
export async function deleteLearner(db: Db, id: string): Promise<boolean> {
  const { rowCount } = await db.query("delete from app.users where id = $1", [id]);
  return (rowCount ?? 0) > 0;
}
