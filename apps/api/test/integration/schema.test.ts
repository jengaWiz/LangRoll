import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createPool } from "../../src/db.js";
import { loadMigrations, migrate } from "../../src/migrate.js";
import { createTestDatabase } from "./helpers.js";

const db = await createTestDatabase();
let pool: pg.Pool;

beforeAll(async () => {
  pool = createPool(db.url);
  await migrate(pool, await loadMigrations(new URL("../../migrations/", import.meta.url)));
});

afterAll(async () => {
  await pool.end();
  await db.drop();
});

async function newUser() {
  const id = randomUUID();
  await pool.query("insert into app.users (id) values ($1)", [id]);
  return id;
}

function addEvent(userId: string, id = randomUUID(), payload: object = {}) {
  return pool.query(
    "insert into app.events (user_id, id, kind, clip_id, payload, occurred_at, day) values ($1, $2, 'clip_viewed', 'es-v1', $3, now(), current_date)",
    [userId, id, payload],
  );
}

// Runs `sql` as a brand-new role with no grants, like Supabase's anon/authenticated roles.
async function asOutsider(sql: string, grant = "") {
  const role = `outsider_${Math.random().toString(36).slice(2, 8)}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`create role ${role} nologin`);
    if (grant) await client.query(grant.replaceAll("$ROLE", role));
    await client.query(`set local role ${role}`);
    return await client.query(sql);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

describe("access", () => {
  it("keeps other database roles out of the app schema", async () => {
    await newUser();
    await expect(asOutsider("select * from app.users")).rejects.toThrow(/permission denied for schema app/);
  });

  it("shows no rows to a role that was granted access by mistake", async () => {
    await newUser();
    const res = await asOutsider("select * from app.users", "grant usage on schema app to $ROLE; grant select on app.users to $ROLE");
    expect(res.rows).toEqual([]);
  });
});

describe("events", () => {
  it("counts a retried event once", async () => {
    const user = await newUser();
    const id = randomUUID();
    await addEvent(user, id);
    await expect(addEvent(user, id)).rejects.toMatchObject({ code: "23505" }); // unique_violation
  });

  it("can't be blocked by another user reusing an event id", async () => {
    const id = randomUUID();
    await addEvent(await newUser(), id);
    await expect(addEvent(await newUser(), id)).resolves.toBeTruthy();
  });

  it("rejects oversized payloads", async () => {
    const user = await newUser();
    const big = { notes: Array.from({ length: 600 }, () => randomUUID()) }; // ~22 KB, incompressible
    await expect(addEvent(user, randomUUID(), big)).rejects.toMatchObject({ code: "23514" }); // check_violation
  });
});

describe("constraints", () => {
  it("rejects values outside their allowed range", async () => {
    const user = await newUser();
    await expect(pool.query("update app.users set daily_goal_xp = 45 where id = $1", [user])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("update app.users set learning_lang = 'spanish' where id = $1", [user])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      pool.query("insert into app.cards (user_id, clip_id, due_at, ease) values ($1, 'es-v1', now(), 9)", [user]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("deletes everything a user owns when the account is deleted", async () => {
    const user = await newUser();
    await addEvent(user);
    await pool.query("insert into app.cards (user_id, clip_id, due_at) values ($1, 'es-v1', now())", [user]);
    await pool.query("insert into app.daily_progress (user_id, day, xp) values ($1, current_date, 15)", [user]);
    await pool.query("delete from app.users where id = $1", [user]);
    const { rows } = await pool.query(
      `select (select count(*) from app.events where user_id = $1)
            + (select count(*) from app.cards where user_id = $1)
            + (select count(*) from app.daily_progress where user_id = $1) as n`,
      [user],
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
