import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["node_modules/", "dist/", "apps/api/dist/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: globals.browser,
    },
    rules: {
      // `catch (e) { /* ignore */ }` is used on purpose around storage and browser APIs
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },
  {
    // The app loads content.js, srs.js and app.js as plain <script> tags that share
    // top-level names, so cross-file globals are expected there.
    files: ["apps/web/**/*.js"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": ["error", { vars: "local", caughtErrors: "none" }],
    },
  },
  {
    files: ["apps/web/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  // The API is TypeScript, type-checked by tsc; these add lint rules on top.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["apps/api/**/*.ts"] })),
  {
    files: ["apps/api/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["eslint.config.js", "playwright.config.js", "scripts/**/*.mjs", "tests/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.node },
  },
];
