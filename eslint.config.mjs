import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Every developer keeps a git worktree of another branch under
    // `.worktrees/`. Without this, a run started from the repository root
    // leaves the branch under test and reports teammates' errors as ours.
    // Covered at runtime by __tests__/lib/eslint-ignores.test.ts.
    ".worktrees/**",
  ]),
]);

export default eslintConfig;
