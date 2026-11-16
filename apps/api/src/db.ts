import pg from "pg";

// What the app needs from the database. Routes depend on this, not on pg directly,
// so unit tests can pass a fake.
export interface Db {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
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
