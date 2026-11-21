import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } },
    // Content and service-worker checks don't use a browser, so they run once, on desktop.
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: /(content|sw|audio)\.spec\.js/ },
    { name: "iphone", use: { ...devices["iPhone 15 Pro"] }, testIgnore: /(content|sw|audio)\.spec\.js/ },
  ],
  // Test the assembled dist/ tree, i.e. exactly what the deploy workflow publishes.
  webServer: {
    command: `node scripts/build-site.mjs && node scripts/serve.mjs ${PORT} dist`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
