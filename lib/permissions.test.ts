import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  can,
  isPermission,
  PERMISSION_LABELS,
  PERMISSIONS,
} from "./permissions";

describe("can", () => {
  it("checks arrays and sets", () => {
    expect(can(["order.create", "discount.apply"], "order.create")).toBe(true);
    expect(can(["order.create"], "order.refund")).toBe(false);
    expect(can(new Set(["drawer.no_sale"]), "drawer.no_sale")).toBe(true);
    expect(can(new Set<string>(), "drawer.no_sale")).toBe(false);
  });

  it("treats a missing list as no permissions", () => {
    expect(can(null, "order.create")).toBe(false);
    expect(can(undefined, "order.create")).toBe(false);
  });
});

describe("isPermission", () => {
  it("recognises only known keys", () => {
    expect(isPermission("order.refund")).toBe(true);
    expect(isPermission("order.made_up")).toBe(false);
  });
});

describe("PERMISSIONS", () => {
  it("matches the database's list of permission keys", () => {
    const migration = readFileSync(
      new URL(
        "../supabase/migrations/20261015140000_foundation_schema.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const check =
      /role_permissions_known_permission check \(permission in \(([^)]*)\)\)/s.exec(
        migration,
      );
    expect(check).not.toBeNull();
    const dbKeys = [...check![1].matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      .sort();
    expect([...PERMISSIONS].sort()).toEqual(dbKeys);
  });

  it("has a label for every key", () => {
    for (const p of PERMISSIONS) expect(PERMISSION_LABELS[p]).toBeTruthy();
  });
});
