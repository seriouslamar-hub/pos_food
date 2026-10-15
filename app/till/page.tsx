import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSignedInUser } from "@/lib/auth";
import { deviceHome } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { autoLockMinutes } from "@/lib/till";
import { TillApp } from "./till-app";

export const metadata: Metadata = { title: "Till" };

export default function TillPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">
          Loading till…
        </div>
      }
    >
      <Till />
    </Suspense>
  );
}

async function Till() {
  const user = await getSignedInUser();
  if (!user?.device) redirect("/device/setup");
  if (user.device.type !== "till") redirect(deviceHome(user.device.type));

  const supabase = await createClient();
  const [{ data: branch }, { data: lockSettings }] = await Promise.all([
    supabase
      .from("branches")
      .select("name")
      .eq("id", user.device.branchId)
      .single(),
    supabase
      .from("settings")
      .select("branch_id, value")
      .eq("key", "till.auto_lock_minutes"),
  ]);

  return (
    <TillApp
      deviceName={user.device.name}
      deviceCode={user.device.code}
      branchName={branch?.name ?? ""}
      autoLockMinutes={autoLockMinutes(lockSettings, user.device.branchId)}
    />
  );
}
