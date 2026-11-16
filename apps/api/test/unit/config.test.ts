import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = "postgres://localhost:5432/langroll";

describe("loadConfig", () => {
  it("fills in local defaults", () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 8787,
      LOG_LEVEL: "info",
      APP_VERSION: "dev",
      DATABASE_URL,
    });
  });

  it("reads the port as a number", () => {
    expect(loadConfig({ DATABASE_URL, PORT: "3000" }).PORT).toBe(3000);
  });

  it("fails fast on bad values and names the setting", () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: "eighty" })).toThrow(/PORT/);
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: "prod" })).toThrow(/NODE_ENV/);
  });

  it("requires a postgres DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: "mysql://localhost/db" })).toThrow(/postgres:\/\//);
  });
});
