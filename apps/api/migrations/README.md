# Migrations

Plain SQL, applied in order by `npm run db:migrate` (see [`src/migrate.ts`](../src/migrate.ts)).

- Name files `NNNN_short_name.sql`, using the next number: `0001_create_users.sql`.
- Each file runs in its own transaction. If any statement fails, none of the file is applied.
- **Never edit a migration after it's merged.** The runner stores a checksum and refuses to
  run if an applied file changed. To fix a mistake, add a new migration.
- If two branches pick the same number, renumber the one that merges second.
