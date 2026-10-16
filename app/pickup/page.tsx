import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PickupBoard } from "@/components/kds/pickup-board";
import { getSignedInUser } from "@/lib/auth";
import { deviceHome } from "@/lib/routes";
import { effectiveSetting } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Pickup" };

export default function PickupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">Loading…</div>
      }
    >
      <Pickup />
    </Suspense>
  );
}

async function Pickup() {
  const user = await getSignedInUser();
  if (!user?.device) redirect("/device/setup");
  if (user.device.type !== "pickup") redirect(deviceHome(user.device.type));
  const supabase = await createClient();
  const branchId = user.device.branchId;
  const [{ data: branch }, { data: rows }] = await Promise.all([
    supabase.from("branches").select("name").eq("id", branchId).single(),
    supabase
      .from("settings")
      .select("key, branch_id, value")
      .in("key", ["pickup.ready_minutes", "pickup.chime"]),
  ]);
  return (
    <PickupBoard
      branchId={branchId}
      branchName={branch?.name ?? ""}
      readyMinutes={Number(
        effectiveSetting("pickup.ready_minutes", rows, branchId),
      )}
      chime={effectiveSetting("pickup.chime", rows, branchId) === true}
    />
  );
}
