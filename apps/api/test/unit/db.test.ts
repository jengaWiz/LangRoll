import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPool } from "../../src/db.js";

const CA = new URL("../../certs/supabase-prod-ca-2021.crt", import.meta.url).pathname;
const URL_WITH_SSLMODE = "postgres://u:p@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require&application_name=x";

// pg keeps its constructor options on the pool; nothing here opens a connection.
const optionsOf = (pool: unknown) => (pool as { options: { connectionString: string; ssl?: unknown } }).options;

describe("createPool", () => {
  it("verifies the database certificate against the given CA", async () => {
    const pool = createPool(URL_WITH_SSLMODE, { caFile: CA });
    const { ssl, connectionString } = optionsOf(pool);
    expect(ssl).toEqual({ ca: readFileSync(CA, "utf8"), rejectUnauthorized: true });
    // sslmode in the URL would override the verified settings, so it's removed; other params stay.
    expect(connectionString).not.toMatch(/sslmode/);
    expect(connectionString).toMatch(/application_name=x/);
    await pool.end();
  });

  it("leaves local connections as they are when no CA is given", async () => {
    const pool = createPool("postgres://postgres@127.0.0.1:5432/postgres");
    expect(optionsOf(pool).ssl).toBeUndefined();
    await pool.end();
  });

  it("ships a CA that is a PEM certificate", () => {
    expect(readFileSync(CA, "utf8")).toMatch(/^-----BEGIN CERTIFICATE-----/);
  });
});
