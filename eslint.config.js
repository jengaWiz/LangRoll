import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: globals.browser,
    },
  },
  {
    // The app loads content.js, srs.js and app.js as plain <script> tags that share
    // top-level names, so cross-file globals are expected there.
    files: ["app/**/*.js"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": ["error", { vars: "local" }],
    },
  },
  {
    files: ["app/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["eslint.config.js", "playwright.config.js", "scripts/**/*.mjs", "tests/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.node },
  },
];
