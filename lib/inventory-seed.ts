// lib/inventory-seed.ts
// ---------------------------------------------------------------------------
// Baseline B6: import data/seeds/owned_inventory.seed.yml into OwnedInventory.
//
// WHY: `pnpm db:seed` (TypeScript) never read this file. Only the legacy Python
// CLI did, so a fresh setup and the production site both showed an empty
// /inventory page whose empty state said "Run database seed", which did not help.
//
// WHY A SMALL PARSER INSTEAD OF A YAML LIBRARY:
//   `yaml`/`js-yaml` are only transitive dependencies here; importing them
//   directly would break when the dependency tree changes. The file uses one
//   simple shape (a list of flat key: value maps), so we parse exactly that and
//   THROW on anything else rather than silently importing wrong data.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "../generated/prisma";

export type InventorySeedRow = Record<string, string | boolean | null | never[]>;

/** Convert one YAML scalar to a JS value. Supports the forms the file uses. */
function parseScalar(raw: string, lineNo: number): string | boolean | null | never[] {
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (value.startsWith("[") || value.startsWith("{") || value === "|" || value === ">") {
    throw new Error(`owned_inventory.seed.yml line ${lineNo}: unsupported YAML value "${value}"`);
  }
  // Strip matching single or double quotes.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse:
 *   owned_inventory:
 *     - key: value
 *       key: value
 * Returns one object per "- " item.
 */
export function parseInventoryYaml(text: string): InventorySeedRow[] {
  const rows: InventorySeedRow[] = [];
  let current: InventorySeedRow | null = null;
  let sawRoot = false;

  text.split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 1;
    if (!line.trim() || line.trim().startsWith("#")) return; // blank / comment

    if (/^owned_inventory:\s*$/.test(line)) {
      sawRoot = true;
      return;
    }
    if (!sawRoot) throw new Error(`owned_inventory.seed.yml line ${lineNo}: expected "owned_inventory:" first`);

    // "  - key: value" starts a new item; "    key: value" continues it.
    const item = /^\s*-\s+([A-Za-z_][\w]*):(.*)$/.exec(line);
    const field = /^\s+([A-Za-z_][\w]*):(.*)$/.exec(line);
    if (item) {
      current = {};
      rows.push(current);
      current[item[1]] = parseScalar(item[2], lineNo);
    } else if (field && current) {
      current[field[1]] = parseScalar(field[2], lineNo);
    } else {
      throw new Error(`owned_inventory.seed.yml line ${lineNo}: cannot parse "${line.trim()}"`);
    }
  });

  return rows;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Upsert every inventory row. OwnedInventory has no unique column, so we match
 * on (displayName, ownerOrg) to keep `pnpm db:seed` safe to run repeatedly.
 * Visibility defaults to "private" when missing: fail safe, not open.
 */
export async function seedOwnedInventory(
  prisma: PrismaClient,
  filePath = resolve(process.cwd(), "data/seeds/owned_inventory.seed.yml")
): Promise<number> {
  const rows = parseInventoryYaml(readFileSync(filePath, "utf8"));
  let saved = 0;

  for (const row of rows) {
    const displayName = asString(row.display_name);
    const ownershipStatus = asString(row.ownership_status);
    if (!displayName || !ownershipStatus) {
      throw new Error(`Inventory row is missing display_name or ownership_status: ${JSON.stringify(row)}`);
    }

    // Link to the robot model if it exists; otherwise keep the record unlinked
    // (robotModelId is nullable) instead of inventing a model.
    const modelName = asString(row.robot_model);
    const model = modelName
      ? await prisma.robotModel.findUnique({ where: { canonicalName: modelName }, select: { id: true } })
      : null;

    const data = {
      robotModelId: model?.id ?? null,
      displayName,
      ownershipStatus,
      ownerOrg: asString(row.owner_org),
      custodian: asString(row.custodian),
      locationLabel: asString(row.location_label),
      serialNumber: asString(row.serial_number),
      publicSerialSafe: row.public_serial_safe === true,
      conditionStatus: asString(row.condition_status),
      accessories: Array.isArray(row.accessories) ? row.accessories : [],
      documentationLinks: Array.isArray(row.documentation_links) ? row.documentation_links : [],
      visibility: asString(row.visibility) ?? "private",
      notes: asString(row.notes)
    };

    const existing = await prisma.ownedInventory.findFirst({
      where: { displayName, ownerOrg: data.ownerOrg },
      select: { id: true }
    });
    if (existing) {
      await prisma.ownedInventory.update({ where: { id: existing.id }, data });
    } else {
      await prisma.ownedInventory.create({ data });
    }
    saved++;
  }

  return saved;
}
