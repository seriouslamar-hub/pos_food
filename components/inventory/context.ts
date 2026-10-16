import { adminBranch } from "@/components/admin/branch-picker";
import type { StaffUser } from "@/lib/auth";

export type InventoryContext = {
  branchId: string;
  /** For admins: every branch, to switch between. */
  branches: { id: string; name: string }[] | null;
  /** A link within the stock pages that keeps the chosen branch. */
  href: (path?: string) => string;
};

/**
 * The branch whose stock is shown: a manager's own branch, or the one an
 * admin chose (?branch=). Null when there's no branch yet.
 */
export async function inventoryContext(
  staff: StaffUser,
  params: Record<string, string | string[] | undefined>,
): Promise<InventoryContext | null> {
  if (staff.role === "admin") {
    const chosen = await adminBranch(params.branch);
    if (!chosen) return null;
    return {
      branchId: chosen.branchId,
      branches: chosen.branches,
      href: (path = "") => `/admin/stock${path}?branch=${chosen.branchId}`,
    };
  }
  if (!staff.branchId) return null;
  return {
    branchId: staff.branchId,
    branches: null,
    href: (path = "") => `/manager/inventory${path}`,
  };
}
