// lib/session.ts
// ---------------------------------------------------------------------------
// Server-side session helpers for Server Components and Server Actions.
//
// WHY SEPARATE FROM lib/auth.ts:
//   `next/headers` (cookies()) cannot be imported by middleware on the Edge
//   runtime. lib/auth.ts stays pure; this file wraps it with cookie I/O.
//
// RULE: every server action that writes data calls requireRole() first.
// Hiding a button in the UI is not access control: server actions are public
// HTTP endpoints and can be called directly.
// ---------------------------------------------------------------------------

import { cookies } from "next/headers";
import {
  LEGACY_COOKIES,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  hasRole,
  signSession,
  verifySession,
  type Role,
  type SessionPayload
} from "./auth";

/** Read and verify the session cookie. null = not logged in (or tampered). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/**
 * Throw unless the caller has at least `required` role.
 * Throwing (not redirecting) is deliberate: a direct POST to a server action
 * must fail loudly, and Next.js turns the error into a failed request.
 */
export async function requireRole(required: Role): Promise<SessionPayload> {
  const session = await getSession();
  if (!session || !hasRole(session.role, required)) {
    throw new Error("Unauthorized: this action requires the " + required + " role.");
  }
  return session;
}

/** Issue a signed, httpOnly session cookie. */
export async function setSession(email: string, role: Role): Promise<void> {
  const token = await signSession({ email, role });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true, // JS in the page cannot read or forge it
    sameSite: "lax", // blocks cross-site POSTs carrying the cookie
    secure: process.env.NODE_ENV === "production", // HTTPS only when deployed
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
  // Remove upstream's unsigned cookies so nothing downstream reads them.
  for (const name of LEGACY_COOKIES) store.delete(name);
}

/** Log out: clear the signed session and any legacy cookies. */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  for (const name of LEGACY_COOKIES) store.delete(name);
}
