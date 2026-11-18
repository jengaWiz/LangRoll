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

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    application_name: "langroll-api",
    max: 10,
    // Fail fast instead of piling up requests when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // No single query may hold a connection for long. Raise it per query if one needs more.
    statement_timeout: 10_000,
  });
}
