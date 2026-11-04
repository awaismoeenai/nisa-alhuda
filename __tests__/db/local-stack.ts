/**
 * A very small harness for tests that have to ask the database itself.
 *
 * `npm run verify` cannot catch a permission regression: a grant or a policy
 * can be dropped and every unit test still passes, because no unit test ever
 * talks to Postgres. This file is the first piece of the harness card #101
 * asks for. It is deliberately tiny — three things a permission test needs:
 *
 *   stackConfig()    the local stack's URL and keys, read at run time
 *   anonFetchRpc()   call an RPC the way a stranger with our publishable key
 *                    would: no Authorization header, no session
 *   sql()            one query as superuser, for the catalog checks REST
 *                    cannot reach (pg_proc.proacl, pg_proc.proconfig)
 *
 * Rules this file obeys, and any test built on it must obey too:
 *
 *  - It never skips. If the local stack is not running, every test that uses
 *    it FAILS with an actionable message. A permission test that quietly
 *    skips itself reads as green while the hole is wide open, which is the
 *    exact failure mode this harness exists to prevent.
 *  - It holds no keys. Everything comes from `supabase status -o json` at run
 *    time, so nothing secret is committed and nothing hosted is reachable:
 *    the CLI only ever reports the local stack.
 *  - Local only. The URLs it returns are 127.0.0.1. Nothing here can touch
 *    the hosted project.
 */
import { execFileSync } from "node:child_process";

export type StackConfig = {
  apiUrl: string;
  dbUrl: string;
  anonKey: string;
  serviceRoleKey: string;
};

const START_HINT =
  "The local Supabase stack is not reachable. Start it with `npm run db:start` " +
  "and re-run. This test is not allowed to skip itself: a permission test that " +
  "skips reads as green while the permission is still open.";

let cached: StackConfig | null = null;

/** Reads the running local stack's config. Throws if it is not running. */
export function stackConfig(): StackConfig {
  if (cached) return cached;

  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  } catch (err) {
    throw new Error(`${START_HINT}\n(supabase status failed: ${String(err)})`);
  }

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${START_HINT}\n(supabase status printed something that is not JSON)`);
  }

  const apiUrl = parsed.API_URL;
  const dbUrl = parsed.DB_URL;
  const anonKey = parsed.ANON_KEY;
  const serviceRoleKey = parsed.SERVICE_ROLE_KEY;

  if (!apiUrl || !dbUrl || !anonKey || !serviceRoleKey) {
    throw new Error(`${START_HINT}\n(supabase status is missing API_URL/DB_URL/keys)`);
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(apiUrl)) {
    throw new Error(
      `Refusing to run a database test against ${apiUrl}. This harness is local-stack only.`
    );
  }

  cached = { apiUrl, dbUrl, anonKey, serviceRoleKey };
  return cached;
}

/**
 * Runs one SQL statement as the database superuser and returns the rows as
 * tab-separated lines (psql -At). For catalog reads PostgREST cannot serve.
 *
 * Uses `psql` if it is on PATH, otherwise the psql inside the stack's own
 * Postgres container — Docker is already required to run the stack at all.
 */
export function sql(query: string): string[] {
  const { dbUrl } = stackConfig();
  const run = (cmd: string, args: string[], input?: string) =>
    execFileSync(cmd, args, {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60_000,
    });

  let out: string;
  try {
    out = run("psql", [dbUrl, "-At", "-c", query]);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
    out = run(
      "docker",
      ["exec", "-i", "supabase_db_nisa-alhuda", "psql", "-U", "postgres", "-d", "postgres", "-At", "-f", "-"],
      query
    );
  }
  return out.split("\n").filter((line) => line.length > 0);
}

export type RpcResult = { status: number; body: unknown };

/**
 * Calls a PostgREST RPC with only the publishable (anon) key and **no
 * Authorization header** — exactly what a stranger can copy out of our own
 * page source. This is the shape of call a leak is found with.
 */
export async function anonFetchRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<RpcResult> {
  const { apiUrl, anonKey } = stackConfig();
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The same RPC, called the way the background job calls it (service role). */
export async function serviceFetchRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<RpcResult> {
  const { apiUrl, serviceRoleKey } = stackConfig();
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
