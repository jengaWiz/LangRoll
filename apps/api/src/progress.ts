import type { Db } from "./db.js";
import { ensureProfile } from "./users.js";

export interface Progress {
  totalXp: number;
  today: { day: string; xp: number; goalXp: number; goalHit: boolean };
  // A streak is a run of consecutive local days with any XP (the app's rule). The current
  // streak survives until the end of the day after the last active day.
  streak: { current: number; longest: number };
}

export async function getProgress(db: Db, userId: string): Promise<Progress> {
  const profile = await ensureProfile(db, userId);
  const { rows } = await db.query<{
    today: string;
    total_xp: string;
    today_xp: number | null;
    today_goal_hit: boolean | null;
    current_streak: string;
    longest_streak: string;
  }>(
    `with today as (
       select (now() at time zone $2)::date as d
     ),
     active as (
       select day, xp, goal_hit from app.daily_progress where user_id = $1 and xp > 0
     ),
     -- Consecutive days share the same (day - row_number), which groups each run.
     runs as (
       select day - (row_number() over (order by day))::int as run, day from active
     ),
     run_lengths as (
       select run, count(*) as days, max(day) as last_day from runs group by run
     )
     select (select d from today)::text as today,
            coalesce((select sum(xp) from active), 0) as total_xp,
            (select xp from active where day = (select d from today)) as today_xp,
            (select goal_hit from active where day = (select d from today)) as today_goal_hit,
            coalesce((select days from run_lengths
                       where last_day >= (select d from today) - 1
                       order by last_day desc limit 1), 0) as current_streak,
            coalesce((select max(days) from run_lengths), 0) as longest_streak`,
    [userId, profile.timezone],
  );
  const r = rows[0]!;
  return {
    totalXp: Number(r.total_xp),
    today: { day: r.today, xp: r.today_xp ?? 0, goalXp: profile.dailyGoalXp, goalHit: r.today_goal_hit ?? false },
    streak: { current: Number(r.current_streak), longest: Number(r.longest_streak) },
  };
}
