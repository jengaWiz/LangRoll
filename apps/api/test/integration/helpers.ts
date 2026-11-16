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
