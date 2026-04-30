import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  // ── Global ignores ─────────────────────────────────────────────
  {
    ignores: [
      ".codex-venv/**",
      ".docker-prod-nightly/**",
      ".installer-tmp/**",
      ".installer-workspace/**",
      ".podman-prod-home/**",
      "install-docker-nightly/**",
      "**/dist/**",
      "**/node_modules/**",
      "server/**",
      "client/dist-node/**",
      "client/public/monaco/**",
    ],
  },

  // ── Base TypeScript rules (all workspaces) ────────────────────
  ...tseslint.configs.strict,
  {
    files: ["client/src/**/*.{ts,tsx}", "extra-clients/browser-extensions/src/**/*.{ts,tsx}"],
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

  // ── Security rules (all workspaces) ───────────────────────────
  {
    files: ["client/src/**/*.{ts,tsx}", "extra-clients/browser-extensions/src/**/*.{ts,tsx}"],
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      // Too many false positives on Record/Map bracket access
      "security/detect-object-injection": "off",
    },
  },

  // ── Test file relaxations ──────────────────────────────────────
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },

  // ── Client-specific rules (React) ─────────────────────────────
  {
    files: ["client/src/**/*.{ts,tsx}", "extra-clients/browser-extensions/src/**/*.{ts,tsx}"],
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
