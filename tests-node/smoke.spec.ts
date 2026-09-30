import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Baseline B5: upstream's smoke test clicked "Login as Administrator" on
// /profile, i.e. it depended on the auth bypass that B1 removes. It now:
//   1. crawls public routes anonymously,
//   2. proves admin routes are closed to anonymous and forged-cookie visitors,
//   3. crawls admin routes after a real /admin-login, when E2E_ADMIN_USER and
//      E2E_ADMIN_PASSWORD are set (they must match ADMIN_BASIC_* in .env).
// ---------------------------------------------------------------------------

const publicRoutes = ["/", "/dashboard", "/perspectives", "/robots", "/inventory", "/contributions", "/analytics", "/submit-data", "/map", "/profile"];
const adminRoutes = ["/admin", "/database", "/data-pulls"];

// Every page should render a non-empty <h1> (catches blank pages and crashes).
async function expectHeading(page: import("@playwright/test").Page) {
  const h1 = page.locator("h1").first();
  await expect(h1).toBeVisible({ timeout: 10000 });
  expect((await h1.innerText()).trim().length).toBeGreaterThan(0);
}

test("public routes render for anonymous visitors", async ({ page }) => {
  for (const route of publicRoutes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expectHeading(page);
  }
});

test("admin routes redirect anonymous visitors to /admin-login", async ({ page }) => {
  for (const route of adminRoutes) {
    await page.goto(route);
    await expect(page, route).toHaveURL(/\/admin-login/);
  }
});

test("forged upstream cookies do not grant admin", async ({ context, page }) => {
  // These are exactly the unsigned cookies upstream trusted.
  await context.addCookies([
    { name: "admin_session", value: "true", url: "http://localhost:3000" },
    { name: "user_role", value: "ADMIN", url: "http://localhost:3000" },
    { name: "hth_session", value: "forged.token", url: "http://localhost:3000" }
  ]);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin-login/);
  const api = await page.request.get("/api/export?table=submissions");
  expect(api.status()).toBe(401);
});

test("private data is not exposed anonymously", async ({ page }) => {
  // /profile no longer lists registered users' emails.
  await page.goto("/profile");
  await expect(page.getByText("Corpus Users List")).toHaveCount(0);
  // /inventory defaults to the public-safe view and ignores ?mode=operator.
  await page.goto("/inventory?mode=operator");
  await expect(page.getByText("Operator Mode (Private)")).toHaveCount(0);
  // The graph API never returns private nodes to anonymous callers.
  const graph = await (await page.request.get("/api/network/graph?includePrivate=true")).json();
  expect(graph.nodes.filter((n: { is_private: boolean }) => n.is_private)).toHaveLength(0);
});

test("admin routes render after a real admin login", async ({ page }) => {
  const user = process.env.E2E_ADMIN_USER;
  const password = process.env.E2E_ADMIN_PASSWORD;
  test.skip(!user || !password, "Set E2E_ADMIN_USER and E2E_ADMIN_PASSWORD to run this test.");

  await page.goto("/admin-login");
  await page.locator('input[name="email"]').fill(user!);
  await page.locator('input[name="password"]').fill(password!);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin/);

  for (const route of adminRoutes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expectHeading(page);
  }
});
