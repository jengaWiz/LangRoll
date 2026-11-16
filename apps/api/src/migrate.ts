import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

// Schema changes are plain SQL files, migrations/NNNN_short_name.sql, applied in order.
// Plain SQL keeps them readable in review and runnable on any Postgres, Supabase included.

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;
// Any constant works; it just has to be the same for every runner of this app.
const LOCK_ID = 7_340_001;

export function migration(version: number, name: string, sql: string): Migration {
  return { version, name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
}

export async function loadMigrations(dir: string | URL): Promise<Migration[]> {
  const path = dir instanceof URL ? fileURLToPath(dir) : dir;
  const out: Migration[] = [];
  for (const file of (await readdir(path)).sort()) {
    if (!file.endsWith(".sql")) continue;
    const match = FILE.exec(file);
    if (!match) throw new Error(`Migration file "${file}" must be named NNNN_short_name.sql`);
    const version = Number(match[1]);
    if (out.some((m) => m.version === version)) throw new Error(`Two migrations share version ${match[1]}`);
    out.push(migration(version, match[2]!, await readFile(join(path, file), "utf8")));
  }
  return out;
}

const label = (m: { version: number; name: string }) => `${String(m.version).padStart(4, "0")}_${m.name}`;

/**
 * Applies every pending migration, each in its own transaction, and returns the ones applied.
 * Refuses to run if an applied migration was edited or deleted, or a new one is older
 * than the latest applied (usually two branches picked the same number).
 */
export async function migrate(pool: pg.Pool, migrations: Migration[]): Promise<string[]> {
  const client = await pool.connect();
  try {
    // Migrations may legitimately run long (index builds), and a second runner must wait
    // for the lock rather than time out, so lift the pool's statement timeout here.
    await client.query("set statement_timeout = 0");
    // Serialise concurrent runners, e.g. two instances starting during a deploy.
    await client.query("select pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`
      create table if not exists schema_migrations (
        version    integer primary key,
        name       text not null,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )`);

    const { rows: applied } = await client.query<{ version: number; name: string; checksum: string }>(
      "select version, name, checksum from schema_migrations order by version",
    );
    for (const row of applied) {
      const file = migrations.find((m) => m.version === row.version);
      if (!file) throw new Error(`Applied migration ${label(row)} is missing from disk`);
      if (file.checksum !== row.checksum) {
        throw new Error(`Migration ${label(file)} was edited after it was applied. Add a new migration instead.`);
      }
    }

    const latest = applied.at(-1)?.version ?? 0;
    const pending = migrations.filter((m) => !applied.some((a) => a.version === m.version));
    const stale = pending.find((m) => m.version < latest);
    if (stale) throw new Error(`Migration ${label(stale)} is older than the latest applied (${latest}). Renumber it.`);

    const done: string[] = [];
    for (const m of pending) {
      try {
        await client.query("begin");
        await client.query(m.sql);
        await client.query("insert into schema_migrations (version, name, checksum) values ($1, $2, $3)", [
          m.version,
          m.name,
          m.checksum,
        ]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${label(m)} failed: ${(err as Error).message}`, { cause: err });
      }
      done.push(label(m));
    }
    return done;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    await client.query("reset statement_timeout").catch(() => {});
    client.release();
  }
}
