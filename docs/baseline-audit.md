# Baseline Audit & Completion

Upstream: `taechasith/HumanoidTH` @ `bef80bdfe895f9403af910951fa251c9baacad2b`
Branch: `fix/baseline`

Every gap below was found by running the upstream code on a fresh Windows setup
(Node 24, pnpm 12, PostgreSQL 16 in Docker) or by reading the code at the SHA
above. Vulnerabilities were demonstrated only on a local copy, never on the
owner's production site.

## Before the fix (upstream, verified by running)

| Check | Result |
|---|---|
| `pnpm install` on a fresh clone without `.env` | Fails: postinstall `prisma generate` throws on `env("DATABASE_URL")` |
| `pnpm install` with pnpm 12 | `ERR_PNPM_IGNORED_BUILDS` until `pnpm approve-builds` |
| `pnpm db:push` / `pnpm db:seed` | Pass: 12 tables; SourceRecord 6,719, RobotModel 17, PerspectiveAnnotation 4, **OwnedInventory 0** |
| `pnpm typecheck` / `pnpm build` | Pass |
| `pnpm test` | 3/3 pass |
| `pnpm check:no-mock-data` | **Fails**: 7 findings (`app/map/actions.ts` x5, `app/network/NetworkGraphClient.tsx` x2) |
| `pnpm network:check` | Fails: `scratch/check-network-sources.mjs` does not exist |

## Gaps and fixes

| ID | Gap (upstream) | Fix | Files |
|---|---|---|---|
| B1 | Admin email/password hardcoded as env fallback (`middleware.ts:30-31`, `app/actions.ts:209-210`) | No fallback; unset env = admin login disabled | `lib/auth.ts`, `middleware.ts`, `app/actions.ts` |
| B1 | `admin_session === "true"` plain cookie grants admin | HMAC-SHA256 signed, httpOnly session (`hth_session`, 8 h); legacy cookies ignored and cleared | `lib/auth.ts`, `lib/session.ts` |
| B1 | `/profile` lets anyone pick role ADMIN; "Login as Administrator" button (`loginAsUser`) | Role selector and `loginAsUser` removed; email login creates USER only, never changes a role; ADMIN accounts must use `/admin-login` | `app/actions.ts`, `app/profile/page.tsx` |
| B1 | Server actions write without any check (`updateSubmissionStatus`, `runDataPull`, `upsert*Action`, map re-analysis) | `requireRole("ADMIN")` at the top of each | `app/actions.ts`, `app/map/actions.ts` |
| B1 | "Run data pull" button shown to every visitor (writes to DB) | Rendered only for admin sessions | `app/layout.tsx` |
| B1 | `analyzeClustersWithGemini` was exported from a `"use server"` file, i.e. a public endpoint that calls the paid Gemini API and writes the cache, with no auth check (found while writing B5 tests) | No longer exported; reachable only through the admin-guarded `reanalyzeClustersWithGemini`. A contract test now fails if any new server action lacks a guard or an explicit public justification | `app/map/actions.ts`, `test/server-actions-guard.test.ts` |
| B2 | pnpm 12 fails a fresh install with `ERR_PNPM_IGNORED_BUILDS` (confirmed on Windows and on a clean copy in the sandbox) | Build scripts approved in the repo: `pnpm-workspace.yaml` (`allowBuilds`, pnpm 12) + `pnpm.onlyBuiltDependencies` (pnpm 9/10). Verified: pnpm 12.8.1 and 10.28.0 both complete `pnpm install` with no `.env` | `pnpm-workspace.yaml`, `package.json` |
| B2 | `scripts/dev.ts` spawns `pnpm.cmd`; seed uses `tsx.CMD` (Windows only) | `pnpm` via shell; `node --import tsx` | `scripts/dev.ts`, `prisma.config.ts` |
| B2 | Install fails before `.env` exists; README orders install before `.env` | `prisma.config.ts` no longer throws for `generate`; README reordered, pnpm build-script note, Docker Postgres step | `prisma.config.ts`, `README.md`, `.env.example` |
| B3 | `/database` raw table browser (submissions with submitter emails, private inventory) open to anonymous visitors | Added to middleware matcher + page-level admin check | `middleware.ts`, `app/database/page.tsx` |
| B3 | `/api/export` relied on middleware only | Route-level admin check (session or Basic) | `app/api/export/route.ts` |
| B3 | `/profile` lists the latest 20 users with emails to everyone | List removed; only the current user's own record is loaded | `app/profile/page.tsx` |
| B3 | `/inventory` defaults to "Operator Mode (Private)" (serials, locations, repair logs) | Public-safe by default; operator mode only for admins | `app/inventory/page.tsx` |
| B3 | `/api/network/graph` includes private inventory unless `includePrivate=false`; includes unreviewed submissions | Private nodes excluded by default (`includePrivate` honoured for admins only); only APPROVED submissions | `lib/network-graph.ts`, `app/api/network/graph/route.ts` |
| B4 | `/map` returns and **writes** 5 hardcoded clusters to `StatsCache` when Gemini fails | Hardcoded list removed; failure writes nothing and shows an error; old placeholder cache detected by ID and hidden; Gemini output validated | `app/map/actions.ts`, `app/map/page.tsx` |
| B4 | Page render calls Gemini on empty cache (anonymous visitors trigger paid API) | Render reads cache only; analysis is an admin action | `app/map/actions.ts` |
| B4 | Private inventory (custodian, location, notes) sent to Gemini | Only `visibility = "public"` inventory is sent | `app/map/actions.ts` |
| B4 | Gemini key in URL query string; model hardcoded to `gemini-1.5-flash` | Key in `x-goog-api-key` header; `GEMINI_MODEL` env | `app/map/actions.ts`, `lib/classifiers.ts` |
| B5 | Smoke test depends on the "Login as Administrator" bypass | Rewritten: public crawl, anonymous/forged-cookie rejection, privacy checks, real admin login via env | `tests-node/smoke.spec.ts` |
| B5 | No tests for server actions or route protection | `test/middleware.test.ts` runs the real middleware against synthetic requests (anonymous, forged cookies, USER, ADMIN, Basic auth, missing env); `test/server-actions-guard.test.ts` scans every `"use server"` export for an admin guard; `authorizeToken` (behind `requireRole`) unit-tested | `test/*.test.ts`, `lib/auth.ts` |
| B5 | `network:check` points to a missing file | Script removed; `test:e2e` added | `package.json` |
| B6 | `pnpm db:seed` never imports `data/seeds/owned_inventory.seed.yml` | Strict parser + idempotent upsert, linked to RobotModel by name | `lib/inventory-seed.ts`, `lib/seed-importer.ts` |
| — | `check:no-mock-data` fails on upstream | Passes (B4 fix + two file-source labels reworded) | `app/network/NetworkGraphClient.tsx` |

## After the fix

| Check | Where verified | Result |
|---|---|---|
| `pnpm db:push` | Windows, fresh machine (Node 24, pnpm 12, Docker Postgres 16) | Pass |
| `pnpm db:seed` | Windows | Pass: "Seeded 2 owned inventory record(s)" (was 0) |
| `pnpm typecheck` | Windows + Linux sandbox | Pass |
| `pnpm test` | Sandbox: 27/27 (unit + middleware integration + server-action guard). Windows: 14/14 on the previous commit; re-run after pulling | Pass |
| `pnpm check:no-mock-data` | Windows + sandbox | Pass (upstream: 7 findings) |
| `pnpm build` | Windows | Pass |
| `pnpm dev` | Windows | Starts, `GET / 200` |
| Install with no `.env` (B2) | Windows (pnpm 12) before this fix: no `DATABASE_URL` error, but `ERR_PNPM_IGNORED_BUILDS`. Sandbox, clean copy after the fix: pnpm 12.8.1 and 10.28.0 both pass (engine download replaced by a local stub because the sandbox blocks binaries.prisma.sh) | Pass in sandbox; **re-run on Windows after pulling** |
| Browser checks (admin redirects, `/inventory`, `/profile`, `/map`) | **To fill in** | [ ] |
| `pnpm test:e2e` | **To fill in** | [ ] |

**Platform note (B2):** the dev script now works without `pnpm.cmd`, but it has only been run on Windows. Linux and macOS are untested. `pnpm dev` prints a harmless Node `DEP0190` warning because the script uses `shell: true` with fixed arguments.

**Inventory note (B6):** the seed file has 2 records, both `visibility: private`. The public `/inventory` view lists them with serial, location and notes masked.

## Known limitations (not fixed; logged as issues)

- **Email login has no password.** Anyone who knows a non-admin user's email can act as that user (see their submissions, submit as them). Admin accounts are protected because email login refuses them. A real fix needs a password/OTP/OAuth flow and a schema change.
- No CSRF token beyond `SameSite=Lax` cookies and Next.js server-action origin checks.
- `lib/classifiers.ts` uses `includes()` without word boundaries and fixed confidence values.
- `@prisma/client` v6 with `@prisma/adapter-pg` v7 version mismatch.
- No rate limiting on `/admin-login`: a password can be guessed online. Use a long password and keep the deployment private until this is added.
- `seedAtlasData` re-creates `submission_record` rows on every run (duplicates).

## Migration note for existing `.env` files

Add `AUTH_SECRET` (32+ chars), `ADMIN_BASIC_USER` and `ADMIN_BASIC_PASSWORD`. Existing logins are invalidated (old cookies are ignored), so everyone signs in again.
