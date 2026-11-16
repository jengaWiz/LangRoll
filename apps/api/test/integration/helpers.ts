// Integration tests run against a real Postgres. They fail loudly rather than skip when
// none is configured, so a missing database in CI can never pass as green.
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests need a Postgres to run against, e.g.\n" +
        "  TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:integration",
    );
  }
  return url;
}

// A fresh, empty database for one test file, dropped afterwards, so tests never share state.
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const { default: pg } = await import("pg");
  const admin = new pg.Client({ connectionString: testDatabaseUrl() });
  await admin.connect();
  const name = `langroll_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  await admin.query(`create database "${name}"`);
  await admin.end();
  const url = new URL(testDatabaseUrl());
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    // pool.end() resolves before its sockets finish closing. Wait for them, because forcing the
    // drop would kill those connections and surface as an unhandled error in the test run.
    drop: async () => {
      const c = new pg.Client({ connectionString: testDatabaseUrl() });
      await c.connect();
      for (let i = 0; i < 50; i++) {
        const { rows } = await c.query("select count(*)::int as n from pg_stat_activity where datname = $1", [name]);
        if (rows[0].n === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await c.query(`drop database if exists "${name}"`);
      await c.end();
    },
  };
}
