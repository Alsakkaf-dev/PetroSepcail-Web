/** Root ESLint config — flat hierarchy across apps/packages/services/workers (ADR-13). */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true }
  },
  plugins: ["@typescript-eslint", "react", "react-hooks"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended"
  ],
  settings: {
    react: { version: "detect" }
  },
  env: {
    node: true,
    es2022: true,
    browser: true
  },
  ignorePatterns: [
    "node_modules",
    "dist",
    ".next",
    "coverage",
    "db/migrations/**",
    "secrets/**",
    "platform-docs/**",
    "**/*.js.map"
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "react/react-in-jsx-scope": "off"
  }
};
