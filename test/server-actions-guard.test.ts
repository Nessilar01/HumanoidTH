// Contract test for B1/B5: every export of a "use server" file is a PUBLIC HTTP
// endpoint. This test fails if someone adds one without deciding its access level.
// (It would have caught the exported analyzeClustersWithGemini in app/map/actions.ts.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Exports that are intentionally callable by anyone. Everything else must call
// requireRole("ADMIN") as its first statement. Adding to this list is a
// deliberate security decision: justify it in the PR.
const PUBLIC_ACTIONS: Record<string, string> = {
  createSubmission: "checks getSession() itself and redirects anonymous users",
  registerAndLoginUser: "email login; cannot create/alter ADMIN (see docs/baseline-audit.md limitations)",
  logoutUser: "clears own session",
  adminLoginAction: "verifies env credentials",
  setLanguage: "sets a language cookie",
  fetchContributionClusters: "read-only, reads cache only"
};

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const serverFiles = walk("app").filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8").slice(0, 60)));

test("the scan finds the known server-action files", () => {
  assert.ok(serverFiles.some((f) => f.replace(/\\/g, "/").endsWith("app/actions.ts")));
  assert.ok(serverFiles.some((f) => f.replace(/\\/g, "/").endsWith("app/map/actions.ts")));
});

test("every exported server action is admin-guarded or explicitly public", () => {
  for (const file of serverFiles) {
    const src = readFileSync(file, "utf8");
    const re = /export\s+async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const [, name, body] = m;
      if (name in PUBLIC_ACTIONS) continue;
      const firstStatement = body.trim().split("\n").find((l) => l.trim() && !l.trim().startsWith("//")) ?? "";
      assert.match(firstStatement, /requireRole\(\s*["']ADMIN["']\s*\)/, `${file}: ${name} must call requireRole("ADMIN") first`);
    }
  }
});

test('no other export shape sneaks into a "use server" file', () => {
  for (const file of serverFiles) {
    const src = readFileSync(file, "utf8");
    // export const/let/default/function (non-async) are all disallowed or unreviewed.
    for (const bad of src.matchAll(/^export\s+(?!async\s+function|type\s|interface\s)(.+)$/gm)) {
      assert.fail(`${file}: unreviewed export "${bad[1].slice(0, 60)}"`);
    }
  }
});

test("upstream auth bypasses stay deleted", () => {
  const files = walk("app").concat(walk("lib"), ["middleware.ts"]);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/loginAsUser/.test(src), `${f}: loginAsUser must not exist`);
    assert.ok(!/admin_session"\)?\??\.value\s*===/.test(src), `${f}: plain admin_session cookie check`);
    assert.ok(!/password\s*\?\?\s*["'][^"']+["']/.test(src), `${f}: hardcoded password fallback`);
  }
});
