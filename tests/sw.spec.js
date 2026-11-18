import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, test } from "@playwright/test";

// Load the real service worker into a sandbox and capture its fetch handler.
function loadWorker() {
  const listeners = {};
  const self = {
    location: new URL("https://jengawiz.github.io/LangRoll/app/sw.js"),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const caches = { match: () => Promise.resolve(undefined), open: () => Promise.resolve({ put() {}, addAll() {} }) };
  vm.runInNewContext(readFileSync("apps/web/sw.js", "utf8"), { self, URL, caches, fetch: () => Promise.resolve({ ok: false }) });
  return (url, method = "GET") => {
    let handled = false;
    listeners.fetch({ request: { url, method }, respondWith: () => { handled = true; } });
    return handled;
  };
}

test.describe("service worker", () => {
  test("caches the app's own files and its fonts", () => {
    const handles = loadWorker();
    expect(handles("https://jengawiz.github.io/LangRoll/app/app.js?v=8")).toBe(true);
    expect(handles("https://fonts.gstatic.com/s/inter/v1/a.woff2")).toBe(true);
  });

  test("never caches the API, auth or other sites", () => {
    const handles = loadWorker();
    expect(handles("https://langroll-api-staging.fly.dev/me/progress")).toBe(false);
    expect(handles("https://drlhfpjnynpajxnqmzjb.supabase.co/auth/v1/user")).toBe(false);
    expect(handles("https://example.com/x.js")).toBe(false);
    expect(handles("https://jengawiz.github.io/LangRoll/app/x", "POST")).toBe(false);
  });
});
