-- The learner's local calendar day an event counts for, set by the server from their timezone.
-- XP limits ("once per clip per day") and streaks are keyed on it.
alter table app.events add column day date;

update app.events e
   set day = (e.occurred_at at time zone u.timezone)::date
  from app.users u
 where u.id = e.user_id;

alter table app.events alter column day set not null;

create index events_user_day_idx on app.events (user_id, day);
