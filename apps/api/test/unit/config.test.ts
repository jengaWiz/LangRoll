import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const DATABASE_URL = "postgres://localhost:5432/langroll";
const SUPABASE_URL = "https://abcd.supabase.co";

describe("loadConfig", () => {
  it("fills in local defaults", () => {
    expect(loadConfig({ SUPABASE_URL, DATABASE_URL })).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 8787,
      LOG_LEVEL: "info",
      APP_VERSION: "dev",
      DATABASE_URL,
      SUPABASE_URL,
      CORS_ORIGINS: ["http://127.0.0.1:4173", "http://localhost:4173"],
      TRUST_PROXY_HOPS: 0,
    });
  });

  it("reads the port as a number", () => {
    expect(loadConfig({ SUPABASE_URL, DATABASE_URL, PORT: "3000" }).PORT).toBe(3000);
  });

  it("fails fast on bad values and names the setting", () => {
    expect(() => loadConfig({ SUPABASE_URL, DATABASE_URL, PORT: "eighty" })).toThrow(/PORT/);
    expect(() => loadConfig({ SUPABASE_URL, DATABASE_URL, NODE_ENV: "prod" })).toThrow(/NODE_ENV/);
  });

  it("requires a postgres DATABASE_URL", () => {
    expect(() => loadConfig({ SUPABASE_URL })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ SUPABASE_URL, DATABASE_URL: "mysql://localhost/db" })).toThrow(/postgres:\/\//);
  });

  it("requires SUPABASE_URL, over https in production", () => {
    expect(() => loadConfig({ DATABASE_URL })).toThrow(/SUPABASE_URL/);
    expect(loadConfig({ DATABASE_URL, SUPABASE_URL: "http://127.0.0.1:54321" }).SUPABASE_URL).toBe("http://127.0.0.1:54321");
    expect(() => loadConfig({ DATABASE_URL, NODE_ENV: "production", SUPABASE_URL: "http://abcd.supabase.co" })).toThrow(
      /https in production/,
    );
  });

  it("reads CORS origins as a list of exact origins", () => {
    expect(loadConfig({ DATABASE_URL, SUPABASE_URL, CORS_ORIGINS: "https://a.example, https://b.example" }).CORS_ORIGINS).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(() => loadConfig({ DATABASE_URL, SUPABASE_URL, CORS_ORIGINS: "https://jengawiz.github.io/LangRoll/" })).toThrow(
      /CORS_ORIGINS/,
    );
    expect(() =>
      loadConfig({ DATABASE_URL, SUPABASE_URL, NODE_ENV: "production", CORS_ORIGINS: "http://jengawiz.github.io" }),
    ).toThrow(/https in production/);
  });
});
