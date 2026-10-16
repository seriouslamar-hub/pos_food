import { adminBranch } from "@/components/admin/branch-picker";
import type { StaffUser } from "@/lib/auth";
import { dateInZone } from "@/lib/datetime";
import { requestTime } from "@/lib/devices";
import { reportRange } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

export type ReportsContext = {
  /** Null: every branch (admins). */
  branchId: string | null;
  /** For admins: the branches to choose from. */
  branches: { id: string; name: string }[] | null;
  /** Today at the branch (the first branch's, for every branch). */
  today: string;
  from: string;
  to: string;
  /** A link within the reports, keeping the branch and dates. */
  href: (path?: string, dates?: { from: string; to: string } | null) => string;
  /** Where Z reports and exceptions live for this role. */
  dayHref: string;
  exceptionsHref: string;
};

/**
 * The branch and dates a report page shows: a manager's own branch, or
 * for admins ?branch= (an id, or "all"). Null when there's no branch yet.
 */
export async function reportsContext(
  staff: StaffUser,
  params: Record<string, string | string[] | undefined>,
): Promise<ReportsContext | null> {
  const supabase = await createClient();
  let branchId: string | null;
  let branches: { id: string; name: string }[] | null = null;
  let base: string;
  if (staff.role === "admin") {
    const chosen = await adminBranch(params.branch);
    if (!chosen) return null;
    branches = chosen.branches;
    branchId = params.branch === "all" ? null : chosen.branchId;
    base = "/admin/reports";
  } else {
    if (!staff.branchId) return null;
    branchId = staff.branchId;
    base = "/manager/reports";
  }
  const { data: branch } = await supabase
    .from("branches")
    .select("timezone")
    .eq("id", branchId ?? branches![0].id)
    .maybeSingle();
  const today = dateInZone(requestTime(), branch?.timezone ?? "UTC");
  const { from, to } = reportRange(params, today);
  const isAdmin = staff.role === "admin";
  return {
    branchId,
    branches,
    today,
    from,
    to,
    href: (path = "", dates = { from, to }) => {
      const query = new URLSearchParams();
      if (isAdmin) query.set("branch", branchId ?? "all");
      if (dates) {
        query.set("from", dates.from);
        query.set("to", dates.to);
      }
      const q = query.toString();
      return `${base}${path}${q ? `?${q}` : ""}`;
    },
    dayHref: isAdmin
      ? `/admin/day${branchId ? `?branch=${branchId}` : ""}`
      : "/manager/day",
    exceptionsHref: isAdmin
      ? `/admin/exceptions${branchId ? `?branch=${branchId}` : ""}`
      : "/manager/exceptions",
  };
}
