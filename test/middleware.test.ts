// Integration tests for B1/B3: run the REAL middleware against synthetic requests.
// No DB, no server: middleware only depends on next/server and lib/auth.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { SESSION_COOKIE, signSession } from "../lib/auth";

const BASE = "http://localhost:3000";

before(() => {
  process.env.AUTH_SECRET = "s".repeat(40);
  process.env.ADMIN_BASIC_USER = "admin@team.local";
  process.env.ADMIN_BASIC_PASSWORD = "correct-horse-battery";
});

// Build a request with optional cookies / headers.
function req(path: string, init: { cookie?: string; auth?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.auth) headers.set("authorization", init.auth);
  return new NextRequest(BASE + path, { headers });
}
const basic = (u: string, p: string) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
const isRedirectToLogin = (res: Response) =>
  res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/admin-login");
// NextResponse.next() marks itself with this header.
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

const adminPages = ["/admin", "/admin/cms", "/admin/submitted-data", "/database", "/data-pulls"];
const adminApis = ["/api/export?table=submissions", "/api/ingest/some-adapter"];

test("anonymous visitors are redirected away from every admin page", async () => {
  for (const p of adminPages) assert.ok(isRedirectToLogin(await middleware(req(p))), p);
});

test("anonymous visitors get 401 on admin APIs", async () => {
  for (const p of adminApis) assert.equal((await middleware(req(p))).status, 401, p);
});

test("upstream forged cookies grant nothing", async () => {
  const cookie = "admin_session=true; user_role=ADMIN; user_email=admin@x.co";
  for (const p of adminPages) assert.ok(isRedirectToLogin(await middleware(req(p, { cookie }))), p);
  for (const p of adminApis) assert.equal((await middleware(req(p, { cookie }))).status, 401, p);
});

test("a valid USER session is still not enough", async () => {
  const token = await signSession({ email: "u@x.co", role: "USER" });
  const cookie = `${SESSION_COOKIE}=${token}`;
  for (const p of adminPages) assert.ok(isRedirectToLogin(await middleware(req(p, { cookie }))), p);
  for (const p of adminApis) assert.equal((await middleware(req(p, { cookie }))).status, 401, p);
});

test("a valid ADMIN session passes pages and APIs", async () => {
  const token = await signSession({ email: "admin@team.local", role: "ADMIN" });
  const cookie = `${SESSION_COOKIE}=${token}`;
  for (const p of [...adminPages, ...adminApis]) assert.ok(passes(await middleware(req(p, { cookie }))), p);
});

test("Basic auth works for APIs only, and only with the right password", async () => {
  const good = basic("admin@team.local", "correct-horse-battery");
  const bad = basic("admin@team.local", "wrong");
  for (const p of adminApis) {
    assert.ok(passes(await middleware(req(p, { auth: good }))), p);
    assert.equal((await middleware(req(p, { auth: bad }))).status, 401, p);
  }
  // Basic auth must not open admin PAGES (they need a session).
  assert.ok(isRedirectToLogin(await middleware(req("/admin", { auth: good }))));
});

test("public routes are untouched", async () => {
  for (const p of ["/", "/robots", "/inventory", "/map"]) assert.ok(passes(await middleware(req(p))), p);
});

test("with no admin env configured, nothing can pass Basic auth", async () => {
  const saved = process.env.ADMIN_BASIC_PASSWORD;
  delete process.env.ADMIN_BASIC_PASSWORD;
  const res = await middleware(req("/api/export", { auth: basic("admin@team.local", "") }));
  process.env.ADMIN_BASIC_PASSWORD = saved;
  assert.equal(res.status, 401);
});
