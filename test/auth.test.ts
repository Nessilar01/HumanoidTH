// Unit tests for B1 signed sessions (runs with `pnpm test`, no DB or server needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { authorizeToken, checkAdminCredentials, hasRole, signSession, verifySession } from "../lib/auth";

const SECRET = "x".repeat(40);

// Each test sets the env it needs, so test order does not matter.
function withEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test("a signed session round-trips", async () => {
  withEnv({ AUTH_SECRET: SECRET });
  const token = await signSession({ email: "a@b.co", role: "USER" });
  const session = await verifySession(token);
  assert.equal(session?.email, "a@b.co");
  assert.equal(session?.role, "USER");
});

test("upstream-style forged cookies are rejected", async () => {
  withEnv({ AUTH_SECRET: SECRET });
  assert.equal(await verifySession("true"), null); // old admin_session value
  assert.equal(await verifySession(undefined), null);
  assert.equal(await verifySession("not.a-valid-token"), null);
});

test("changing the role inside the payload breaks the signature", async () => {
  withEnv({ AUTH_SECRET: SECRET });
  const token = await signSession({ email: "a@b.co", role: "USER" });
  const [, sig] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ email: "a@b.co", role: "ADMIN", exp: 9999999999 }))
    .toString("base64url");
  assert.equal(await verifySession(`${forgedBody}.${sig}`), null);
});

test("a token signed with another secret is rejected", async () => {
  withEnv({ AUTH_SECRET: "y".repeat(40) });
  const token = await signSession({ email: "a@b.co", role: "ADMIN" });
  withEnv({ AUTH_SECRET: SECRET });
  assert.equal(await verifySession(token), null);
});

test("expired tokens are rejected", async () => {
  withEnv({ AUTH_SECRET: SECRET });
  const issuedAt = 1_000_000;
  const token = await signSession({ email: "a@b.co", role: "USER" }, issuedAt);
  assert.equal(await verifySession(token, issuedAt + 60 * 60 * 9), null); // TTL is 8 h
});

test("missing or short AUTH_SECRET fails closed", async () => {
  withEnv({ AUTH_SECRET: undefined });
  await assert.rejects(() => signSession({ email: "a@b.co", role: "USER" }), /AUTH_SECRET/);
  withEnv({ AUTH_SECRET: "short" });
  await assert.rejects(() => signSession({ email: "a@b.co", role: "USER" }), /AUTH_SECRET/);
});

test("admin credentials: no env means no login, and wrong password fails", async () => {
  withEnv({ ADMIN_BASIC_USER: undefined, ADMIN_BASIC_PASSWORD: undefined });
  // The upstream hardcoded fallback must not work any more.
  assert.equal(await checkAdminCredentials("creativelab.co.th@gmail.com", "anything"), false);
  withEnv({ ADMIN_BASIC_USER: "admin@x.co", ADMIN_BASIC_PASSWORD: "s3cret:with:colons" });
  assert.equal(await checkAdminCredentials("admin@x.co", "s3cret:with:colons"), true);
  assert.equal(await checkAdminCredentials("admin@x.co", "wrong"), false);
  assert.equal(await checkAdminCredentials("other@x.co", "s3cret:with:colons"), false);
});

test("role ranking", () => {
  assert.equal(hasRole("ADMIN", "USER"), true);
  assert.equal(hasRole("USER", "ADMIN"), false);
  assert.equal(hasRole("RESEARCHER", "RESEARCHER"), true);
  assert.equal(hasRole(undefined, "USER"), false);
});

test("authorizeToken (used by requireRole): anonymous and USER are rejected, ADMIN passes", async () => {
  withEnv({ AUTH_SECRET: SECRET });
  await assert.rejects(() => authorizeToken(undefined, "ADMIN"), /Unauthorized/);
  await assert.rejects(() => authorizeToken("forged.token", "ADMIN"), /Unauthorized/);
  const user = await signSession({ email: "u@x.co", role: "USER" });
  await assert.rejects(() => authorizeToken(user, "ADMIN"), /Unauthorized/);
  const admin = await signSession({ email: "a@x.co", role: "ADMIN" });
  assert.equal((await authorizeToken(admin, "ADMIN")).role, "ADMIN");
  assert.equal((await authorizeToken(user, "USER")).role, "USER");
});
