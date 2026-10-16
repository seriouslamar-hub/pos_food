import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { AvailabilityBoard } from "@/components/menu/availability-board";
import { OnlineOrderingToggle } from "@/components/order/online-toggle";
import { requireStaff } from "@/lib/auth";
import { effectiveSetting } from "@/lib/settings";
import { parseMenu } from "@/lib/menu";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Availability" };

export default function ManagerAvailabilityPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Availability />
    </Suspense>
  );
}

async function Availability() {
  const staff = await requireStaff(["admin", "manager"]);
  if (staff.role === "admin" || !staff.branchId)
    redirect("/admin/availability");
  const supabase = await createClient();
  const [{ data, error }, { data: online }] = await Promise.all([
    supabase.rpc("get_menu", { p_branch_id: staff.branchId }),
    supabase
      .from("settings")
      .select("key, branch_id, value")
      .in("key", ["online.enabled", "online.paused"]),
  ]);
  const onlineEnabled =
    effectiveSetting("online.enabled", online, staff.branchId) === true;
  const onlinePaused =
    (online ?? []).find(
      (r) => r.key === "online.paused" && r.branch_id === staff.branchId,
    )?.value === true;

  return (
    <AdminPage>
      <PageHeader
        title="Availability"
        description="Mark items and extras out of stock. Every till in your branch updates within seconds."
      />
      {onlineEnabled ? (
        <OnlineOrderingToggle branchId={staff.branchId} paused={onlinePaused} />
      ) : null}
      {error || !data ? (
        <EmptyState>
          The menu couldn&apos;t be loaded. Refresh to try again.
        </EmptyState>
      ) : (
        <AvailabilityBoard
          branchId={staff.branchId}
          initialMenu={parseMenu(data)}
        />
      )}
    </AdminPage>
  );
}
