// lib/auth.ts
// ---------------------------------------------------------------------------
// Signed session tokens + admin credential checks.
//
// WHY THIS FILE EXISTS (Baseline B1):
//   Upstream trusted plain cookies (`admin_session=true`, `user_role=ADMIN`).
//   Anyone could set those in DevTools and become admin. Here the session is a
//   payload + HMAC-SHA256 signature, so the server can detect tampering.
//
// WHY WEB CRYPTO (not node:crypto):
//   middleware.ts runs on the Edge runtime, where `node:crypto` is unavailable.
//   `globalThis.crypto.subtle` works on Edge and on Node >= 20 (server actions,
//   tests), so one implementation covers both.
//
// This module is PURE: no `next/headers` import, so middleware can use it.
// Cookie read/write helpers for server components/actions live in lib/session.ts.
// ---------------------------------------------------------------------------

export type Role = "USER" | "RESEARCHER" | "ADMIN";

export type SessionPayload = {
  email: string;
  role: Role;
  exp: number; // expiry, unix seconds
};

export const SESSION_COOKIE = "hth_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours: one working/demo day

// Legacy upstream cookies. We no longer trust or set them; logout clears them
// so old browsers do not keep stale values around.
export const LEGACY_COOKIES = ["admin_session", "user_role", "user_email"] as const;

const ROLE_RANK: Record<Role, number> = { USER: 1, RESEARCHER: 2, ADMIN: 3 };
const MIN_SECRET_LENGTH = 32;

// ---------- secret handling ----------

/**
 * Read AUTH_SECRET. Fail CLOSED: with no (or a too-short) secret we refuse to
 * sign or verify anything, instead of falling back to a default value.
 * A hardcoded fallback is exactly the upstream bug we are removing.
 */
export function getAuthSecret(): string | null {
  const secret = process.env.AUTH_SECRET ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

// ---------- base64url helpers (Edge-safe, no Buffer) ----------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------- HMAC core ----------

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

/** Constant-time comparison of two byte arrays (avoids timing leaks). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- public API: sign / verify ----------

function isRole(value: unknown): value is Role {
  return value === "USER" || value === "RESEARCHER" || value === "ADMIN";
}

/**
 * Create a token: base64url(JSON payload) + "." + base64url(HMAC(payload)).
 * Throws if AUTH_SECRET is missing, so a misconfigured server cannot hand out
 * unsigned sessions.
 */
export async function signSession(
  input: { email: string; role: Role },
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<string> {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error(`AUTH_SECRET is not set (need at least ${MIN_SECRET_LENGTH} characters). Login is disabled.`);
  }
  const payload: SessionPayload = { email: input.email, role: input.role, exp: nowSeconds + SESSION_TTL_SECONDS };
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = bytesToBase64Url(await hmac(secret, body));
  return `${body}.${sig}`;
}

/**
 * Verify a token. Returns the payload only if the signature matches, the JSON
 * is well formed, the role is known and the token has not expired.
 * Any failure returns null (never throws) so callers treat it as "logged out".
 */
export async function verifySession(
  token: string | undefined | null,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<SessionPayload | null> {
  const secret = getAuthSecret();
  if (!secret || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  try {
    const expected = await hmac(secret, body);
    if (!bytesEqual(expected, base64UrlToBytes(sig))) return null;

    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(body))) as Partial<SessionPayload>;
    if (typeof parsed.email !== "string" || !parsed.email) return null;
    if (!isRole(parsed.role)) return null;
    if (typeof parsed.exp !== "number" || parsed.exp <= nowSeconds) return null;
    return { email: parsed.email, role: parsed.role, exp: parsed.exp };
  } catch {
    return null; // malformed base64 / JSON
  }
}

/** True when `role` is at least `required` (ADMIN > RESEARCHER > USER). */
export function hasRole(role: Role | undefined | null, required: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

// ---------- admin credentials ----------

/**
 * Admin credentials come ONLY from env (ADMIN_BASIC_USER / ADMIN_BASIC_PASSWORD).
 * No fallback: if either is unset, admin login is disabled entirely.
 * Comparison hashes both sides with HMAC first so the compare is constant-time
 * regardless of input length.
 */
export async function checkAdminCredentials(user: string, password: string): Promise<boolean> {
  const expectedUser = process.env.ADMIN_BASIC_USER ?? "";
  const expectedPassword = process.env.ADMIN_BASIC_PASSWORD ?? "";
  if (!expectedUser || !expectedPassword) return false;

  // Any fixed key works here: we only need equal-length digests to compare.
  const key = "hth-credential-compare";
  const [a, b, c, d] = await Promise.all([
    hmac(key, user),
    hmac(key, expectedUser),
    hmac(key, password),
    hmac(key, expectedPassword)
  ]);
  // Evaluate both comparisons (no short-circuit) to keep timing uniform.
  const userOk = bytesEqual(a, b);
  const passOk = bytesEqual(c, d);
  return userOk && passOk;
}
