import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("fills in local defaults", () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: 8787,
      LOG_LEVEL: "info",
      APP_VERSION: "dev",
    });
  });

  it("reads the port as a number", () => {
    expect(loadConfig({ PORT: "3000" }).PORT).toBe(3000);
  });

  it("fails fast on bad values and names the setting", () => {
    expect(() => loadConfig({ PORT: "eighty" })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: "prod" })).toThrow(/NODE_ENV/);
  });
});
