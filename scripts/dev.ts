import { spawn } from "node:child_process";

// ---------------------------------------------------------------------------
// Baseline B2: runs `next dev` and the seed watcher together.
// Upstream spawned "pnpm.cmd", which exists only on Windows. With shell: true
// the OS shell resolves plain "pnpm" (pnpm.cmd on Windows, pnpm elsewhere),
// so the same script works on Windows, macOS and Linux.
// ---------------------------------------------------------------------------
const pnpm = "pnpm";

const nextDev = spawn(pnpm, ["dev:next"], { stdio: "inherit", shell: true });
const seedWatch = spawn(pnpm, ["seed:watch"], { stdio: "inherit", shell: true });

// When either child exits (or we get Ctrl+C), stop both so no orphan process
// keeps port 3000 busy.
function shutdown(code = 0) {
  nextDev.kill();
  seedWatch.kill();
  process.exit(code);
}

nextDev.on("exit", (code) => shutdown(code ?? 0));
seedWatch.on("exit", (code) => shutdown(code ?? 0));

process.on("SIGINT", () => shutdown(130));
process.on("SIGTERM", () => shutdown(143));
