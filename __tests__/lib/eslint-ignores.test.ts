// @vitest-environment node
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Every developer on this project keeps a git worktree under `.worktrees/`, so
 * from the repository root `eslint` walks straight into everyone else's
 * in-progress branch and reports their errors as if they were ours. These tests
 * pin the ignore down at runtime — they ask the real resolved config whether a
 * path is ignored, rather than reading `eslint.config.mjs` as text, because a
 * source-reading check proves the line exists and never that it bites.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const eslint = new ESLint({ cwd: repoRoot });

const isIgnored = (relativePath: string) =>
  eslint.isPathIgnored(path.join(repoRoot, relativePath));

describe("eslint globalIgnores", () => {
  it("ignores another developer's worktree", async () => {
    await expect(isIgnored(".worktrees/developer-9/src/app/page.tsx")).resolves.toBe(true);
    await expect(isIgnored(".worktrees/qa-engineer-70/src/lib/fees.ts")).resolves.toBe(true);
    await expect(isIgnored(".worktrees/developer-9/__tests__/lib/fees.test.ts")).resolves.toBe(true);
  });

  it("still lints every part of the branch under test", async () => {
    await expect(isIgnored("src/lib/fees.ts")).resolves.toBe(false);
    await expect(isIgnored("__tests__/lib/fees.test.ts")).resolves.toBe(false);
    await expect(isIgnored("scripts/seed.ts")).resolves.toBe(false);
  });

  it("keeps ignoring the generated output it always ignored", async () => {
    await expect(isIgnored(".next/static/chunk.js")).resolves.toBe(true);
    await expect(isIgnored("next-env.d.ts")).resolves.toBe(true);
  });
});
