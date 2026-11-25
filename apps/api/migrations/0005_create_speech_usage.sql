-- How many pronunciation checks each learner used per day (UTC). Every check is billed by the
-- speech service, so the API stops at a daily cap and the app falls back to the phone's own
-- recognition. Goes with the learner when they delete their data.
create table app.speech_usage (
  user_id  uuid not null references app.users (id) on delete cascade,
  day      date not null,
  attempts integer not null check (attempts > 0),
  primary key (user_id, day)
);

alter table app.speech_usage enable row level security;
