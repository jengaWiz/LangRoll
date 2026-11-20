-- Feedback testers send from the app. Read it in Supabase: Table Editor, schema "app", table
-- "feedback". It belongs to the learner, so "Delete my data" removes it too.
create table app.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app.users (id) on delete cascade,
  message     text not null check (length(message) between 1 and 2000),
  app_version text check (length(app_version) <= 40),
  -- A coarse label such as "iPhone Safari": enough to spot device bugs, unlike a full user agent.
  platform    text check (length(platform) <= 80),
  created_at  timestamptz not null default now()
);
create index feedback_created_idx on app.feedback (created_at desc);

alter table app.feedback enable row level security;
