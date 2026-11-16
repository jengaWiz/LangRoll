import { afterAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createPool } from "../../src/db.js";
import { loadMigrations, migrate, migration } from "../../src/migrate.js";
import { createTestDatabase } from "./helpers.js";

const db = await createTestDatabase();
const pools: pg.Pool[] = [];
let pool: pg.Pool;

function newPool() {
  const p = createPool(db.url);
  pools.push(p);
  return p;
}

beforeEach(async () => {
  pool = newPool();
  await pool.query("drop schema public cascade; create schema public");
});

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  await db.drop();
});

const tables = async () =>
  (await pool.query<{ t: string }>("select tablename as t from pg_tables where schemaname = 'public' order by 1")).rows.map(
    (r) => r.t,
  );

const one = migration(1, "create_a", "create table a (id int primary key);");
const two = migration(2, "create_b", "create table b (id int primary key);");

describe("migrate", () => {
  it("applies pending migrations in order and records them", async () => {
    expect(await migrate(pool, [one, two])).toEqual(["0001_create_a", "0002_create_b"]);
    expect(await tables()).toEqual(["a", "b", "schema_migrations"]);
  });

  it("does nothing when already up to date", async () => {
    await migrate(pool, [one]);
    expect(await migrate(pool, [one])).toEqual([]);
    expect(await migrate(pool, [one, two])).toEqual(["0002_create_b"]);
  });

  it("rolls back a failing migration and keeps the ones before it", async () => {
    const bad = migration(2, "half_done", "create table b (id int); select * from does_not_exist;");
    await expect(migrate(pool, [one, bad])).rejects.toThrow(/0002_half_done failed: .*does_not_exist/);
    expect(await tables()).toEqual(["a", "schema_migrations"]);
    expect(await migrate(pool, [one, two])).toEqual(["0002_create_b"]);
  });

  it("refuses to run when an applied migration was edited", async () => {
    await migrate(pool, [one]);
    const edited = migration(1, "create_a", "create table a (id bigint primary key);");
    await expect(migrate(pool, [edited, two])).rejects.toThrow(/0001_create_a was edited/);
    expect(await tables()).toEqual(["a", "schema_migrations"]);
  });

  it("refuses to run when an applied migration is missing", async () => {
    await migrate(pool, [one, two]);
    await expect(migrate(pool, [two])).rejects.toThrow(/0001_create_a is missing/);
  });

  it("refuses a new migration numbered below the latest applied", async () => {
    await migrate(pool, [one, migration(3, "create_c", "create table c (id int);")]);
    await expect(migrate(pool, [one, two, migration(3, "create_c", "create table c (id int);")])).rejects.toThrow(
      /0002_create_b is older than the latest applied/,
    );
  });

  it("applies each migration once when two runners start together", async () => {
    const slow = migration(1, "slow", "select pg_sleep(0.3); create table a (id int);");
    const [x, y] = await Promise.all([migrate(newPool(), [slow, two]), migrate(newPool(), [slow, two])]);
    expect([...x, ...y].sort()).toEqual(["0001_slow", "0002_create_b"]);
  });

  it("ships migrations that apply cleanly to an empty database", async () => {
    const shipped = await loadMigrations(new URL("../../migrations/", import.meta.url));
    await migrate(pool, shipped);
    expect(await migrate(pool, shipped)).toEqual([]);
  });
});
