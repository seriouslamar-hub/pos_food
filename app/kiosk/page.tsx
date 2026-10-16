import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { KioskApp } from "@/components/kiosk/kiosk-app";
import { getSignedInUser } from "@/lib/auth";
import { deviceHome } from "@/lib/routes";
import { effectiveSetting } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Order here" };

export default function KioskPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-2xl">
          Loading…
        </div>
      }
    >
      <Kiosk />
    </Suspense>
  );
}

async function Kiosk() {
  const user = await getSignedInUser();
  if (!user?.device) redirect("/device/setup");
  if (user.device.type !== "kiosk") redirect(deviceHome(user.device.type));
  const supabase = await createClient();
  const branchId = user.device.branchId;
  const { data: rows } = await supabase
    .from("settings")
    .select("key, branch_id, value")
    .in("key", ["kiosk.idle_seconds"]);
  return (
    <KioskApp
      branchId={branchId}
      idleSeconds={Number(
        effectiveSetting("kiosk.idle_seconds", rows, branchId),
      )}
    />
  );
}
