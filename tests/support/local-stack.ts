/**
 * Harness for permission regression tests (cards #63, #65 — and the
 * general gap recorded as #101).
 *
 * Lives here rather than under __tests__/ because both the vitest
 * permission tests (__tests__/db/) and the Playwright specs (tests/e2e/)
 * build their fixtures with it. vitest only collects __tests__/**, so
 * nothing in this folder is mistaken for a test.
 *
 * Why this exists: `npm run verify` could not catch a permission
 * regression. A policy or a column grant could be dropped and the suite
 * would stay green, which is how #70 stayed broken for months. RLS and
 * column grants only answer to a real request from a real role, so these
 * tests talk HTTP to a real PostgREST, exactly the way the browser does.
 *
 * Three rules this harness is built around:
 *
 *   1. It never skips. A permission test that skips itself when the
 *      database is absent reads as green and is worse than no test. If
 *      the local stack is not answering, every test in the file FAILS
 *      with a message telling you to run `npm run db:start`.
 *   2. It refuses to run against anything that is not local. The guard
 *      is on the hostname, before any request is made. These tests write
 *      rows and change roles; pointed at a hosted project they would do
 *      that to real sisters' accounts.
 *   3. Nothing is asserted from an HTTP status alone. PostgREST answers
 *      204 to an UPDATE that matched zero rows, so "it returned 204" and
 *      "it changed something" are different claims. Read the value back
 *      with the service-role key and compare before to after.
 */
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const RAW_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "[::1]"]);

/** Columns a service-role read may ask for without tripping the 046 grant. */
export const ALL_PROFILE_COLUMNS =
  "id,full_name,avatar_url,phone,role,roles,is_suspended,must_change_password,lock_override,updated_at";

export interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: string;
  roles: string[];
  is_suspended: boolean;
  must_change_password: boolean;
  lock_override: boolean | null;
  updated_at: string | null;
}

/**
 * The base URL of the local stack, or a thrown error that explains what to
 * do. Called once at the top of every DB test file so a missing stack is a
 * loud red failure and never a silent pass.
 */
export function localStackUrl(): string {
  if (!RAW_URL || !ANON_KEY || !SERVICE_KEY) {
    throw new Error(
      "Permission tests need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "and SUPABASE_SERVICE_ROLE_KEY in .env.local. Run `npm run env:local`."
    );
  }

  let host: string;
  try {
    host = new globalThis.URL(RAW_URL).hostname;
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a URL: ${RAW_URL}`);
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `REFUSING TO RUN: these permission tests create users, change roles and ` +
        `suspend accounts, and ${host} is not the local stack. Run ` +
        `\`npm run env:local\` and \`npm run db:start\` first. They must never ` +
        `be pointed at a hosted project.`
    );
  }

  return RAW_URL.replace(/\/$/, "");
}

export function anonKey(): string {
  localStackUrl();
  return ANON_KEY;
}

/**
 * Fails loudly when the stack is not up. Call it in `beforeAll` — a
 * connection refused must read as a broken check, not as a clean result.
 */
export async function requireLocalStack(): Promise<void> {
  const url = localStackUrl();
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: ANON_KEY },
    });
    if (res.status >= 500) {
      throw new Error(`PostgREST answered ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `The local Supabase stack is not answering at ${url}. These are ` +
        `permission regression tests and they do not skip themselves — a ` +
        `skipped permission test is how a hole ships. Start it with ` +
        `\`npm run db:start\`. (${(err as Error).message})`
    );
  }
}

interface RestOptions {
  /** A user access token. Omit for an anonymous request. */
  token?: string;
  /** Use the service-role key instead of the publishable key. */
  service?: boolean;
  method?: string;
  body?: unknown;
  prefer?: string;
}

export interface RestResponse {
  status: number;
  /** Parsed JSON when the body was JSON, otherwise null. */
  body: unknown;
}

/** One request to PostgREST, shaped the way the browser shapes it. */
export async function rest(
  path: string,
  options: RestOptions = {}
): Promise<RestResponse> {
  const url = localStackUrl();
  const key = options.service ? SERVICE_KEY : ANON_KEY;
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${options.token ?? key}`,
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.prefer) headers["Prefer"] = options.prefer;

  const res = await fetch(`${url}/rest/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

async function auth(
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = localStackUrl();
  const res = await fetch(`${url}/auth/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

/**
 * Create a confirmed fixture account and return its user id. Any earlier
 * account with the same address is removed first, so a crashed run does
 * not poison the next one.
 */
export async function createFixtureUser(
  email: string,
  password: string,
  fullName: string
): Promise<string> {
  await deleteFixtureUser(email);

  const created = await auth("/admin/users", {
    method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    },
  });
  const id = created.body.id;
  if (typeof id !== "string" || !id) {
    throw new Error(
      `Could not create the fixture account ${email}: ${JSON.stringify(created.body)}`
    );
  }
  return id;
}

/** Remove a fixture account by email. Safe to call when it does not exist. */
export async function deleteFixtureUser(email: string): Promise<void> {
  const list = await auth(`/admin/users?per_page=1000`);
  const users = (list.body.users as Array<{ id: string; email?: string }>) ?? [];
  for (const u of users) {
    if (u.email === email) {
      await auth(`/admin/users/${u.id}`, { method: "DELETE" });
    }
  }
}

/** Sign in with the publishable key, exactly as the browser does. */
export async function signIn(email: string, password: string): Promise<string> {
  const url = localStackUrl();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error(`Could not sign ${email} in: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

/** The claims inside an access token, so a test can prove whose it is. */
export function tokenClaims(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const padded = part.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Read a profile row with the service-role key — the honest before/after
 * signal. Throws when the row is missing, so a vanished fixture is a red
 * test and never a quiet pass.
 */
export async function readProfile(id: string): Promise<ProfileRow> {
  const res = await rest(
    `/profiles?id=eq.${id}&select=${ALL_PROFILE_COLUMNS}`,
    { service: true }
  );
  const rows = res.body as ProfileRow[] | null;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(
      `Expected exactly one profile row for ${id}, got ${JSON.stringify(res.body)}. ` +
        `A check that matches zero rows is broken, not clean.`
    );
  }
  return rows[0];
}

/** Write to a profile row with the service-role key (fixture setup only). */
export async function setProfile(
  id: string,
  patch: Record<string, unknown>
): Promise<RestResponse> {
  return rest(`/profiles?id=eq.${id}`, {
    service: true,
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
  });
}

/** Write to a profile row as a signed-in sister (or anonymously). */
export async function patchProfileAs(
  id: string,
  patch: Record<string, unknown>,
  token?: string
): Promise<RestResponse> {
  return rest(`/profiles?id=eq.${id}`, {
    token,
    method: "PATCH",
    body: patch,
    prefer: "return=minimal",
  });
}
