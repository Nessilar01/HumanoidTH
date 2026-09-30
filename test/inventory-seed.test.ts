// Unit tests for the B6 inventory YAML parser (runs with `pnpm test`, no DB needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseInventoryYaml } from "../lib/inventory-seed";

test("parses the real owned_inventory.seed.yml", () => {
  const rows = parseInventoryYaml(readFileSync("data/seeds/owned_inventory.seed.yml", "utf8"));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].robot_model, "Unitree G1");
  assert.equal(rows[0].visibility, "private");
  assert.equal(rows[0].public_serial_safe, false);
  assert.deepEqual(rows[0].accessories, []);
});

test("handles quotes, null and CRLF line endings", () => {
  const rows = parseInventoryYaml('owned_inventory:\r\n  - display_name: "A: B"\r\n    notes:\r\n');
  assert.deepEqual(rows, [{ display_name: "A: B", notes: null }]);
});

test("rejects YAML shapes it does not support instead of guessing", () => {
  assert.throws(() => parseInventoryYaml("owned_inventory:\n  - accessories: [a, b]\n"), /unsupported/);
  assert.throws(() => parseInventoryYaml("other_root:\n  - a: b\n"), /expected/);
});
