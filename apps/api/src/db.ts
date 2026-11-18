import { readFileSync } from "node:fs";
import pg from "pg";

// What the app needs from the database. Routes depend on this, not on pg directly,
// so unit tests can pass a fake.
export interface Db {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
  // Runs `fn` in one transaction on one connection: committed if it resolves, rolled back if it throws.
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export function createDb(pool: pg.Pool): Db {
  return {
    query: (text, values) => pool.query(text, values),
    transaction: async (fn) => {
      const client = await pool.connect();
      const tx: Db = {
        query: (text, values) => client.query(text, values),
        transaction: () => Promise.reject(new Error("nested transactions are not supported")),
      };
      try {
        await client.query("begin");
        const result = await fn(tx);
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// TLS options in the URL would override the verified settings below, so they are removed.
const URL_TLS_PARAMS = ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"];

export interface PoolOptions {
  // PEM file of the CA that signed the database's certificate (Supabase uses its own CA).
  // When set, the connection is encrypted and both certificate and hostname are verified.
  caFile?: string | undefined;
}

export function createPool(connectionString: string, opts: PoolOptions = {}): pg.Pool {
  let url = connectionString;
  let ssl: pg.PoolConfig["ssl"];
  if (opts.caFile) {
    const parsed = new URL(connectionString);
    for (const p of URL_TLS_PARAMS) parsed.searchParams.delete(p);
    url = parsed.toString();
    ssl = { ca: readFileSync(opts.caFile, "utf8"), rejectUnauthorized: true };
  }
  return new pg.Pool({
    connectionString: url,
    ...(ssl && { ssl }),
    application_name: "langroll-api",
    max: 10,
    // Fail fast instead of piling up requests when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // No single query may hold a connection for long. Raise it per query if one needs more.
    statement_timeout: 10_000,
  });
}
