// ESLint flat config — lints the Node test files only. The app itself is
// a single inline <script> in index.html (no module split, by design);
// test.js extracts and syntax-checks that script instead.
export default [
  {
    files: ["test.js", "tests/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs" },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
];
