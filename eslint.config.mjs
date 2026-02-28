import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  // ── Global ignores ─────────────────────────────────────────────
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "server/src/generated/**",
      "client/dist-node/**",
    ],
  },

  // ── Base TypeScript rules (both workspaces) ────────────────────
  ...tseslint.configs.strict,
  {
    files: ["server/src/**/*.ts", "client/src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // ── Security rules (both workspaces) ───────────────────────────
  {
    files: ["server/src/**/*.ts", "client/src/**/*.{ts,tsx}"],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      // Too many false positives on Record/Map bracket access
      "security/detect-object-injection": "off",
    },
  },

  // ── Server-specific rules ──────────────────────────────────────
  {
    files: ["server/src/**/*.ts"],
    rules: {
      // Server has a logger utility — discourage raw console usage
      "no-console": "warn",
    },
  },

  // ── Client-specific rules (React) ─────────────────────────────
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  }
);
