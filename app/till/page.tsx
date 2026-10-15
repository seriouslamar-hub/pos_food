import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSignedInUser } from "@/lib/auth";
import { deviceHome } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { TILL_SETTING_KEYS, tillSettings } from "@/lib/till";
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
  const [{ data: branch }, { data: settingRows }] = await Promise.all([
    supabase
      .from("branches")
      .select("name, currency_code, timezone")
      .eq("id", user.device.branchId)
      .single(),
    supabase
      .from("settings")
      .select("key, branch_id, value")
      .in("key", [...TILL_SETTING_KEYS]),
  ]);

  return (
    <TillApp
      branchId={user.device.branchId}
      deviceId={user.device.id}
      deviceName={user.device.name}
      deviceCode={user.device.code}
      branchName={branch?.name ?? ""}
      currency={branch?.currency_code ?? "USD"}
      timezone={branch?.timezone ?? "UTC"}
      settings={tillSettings(
        settingRows,
        user.device.branchId,
        branch?.currency_code ?? "USD",
      )}
    />
  );
}
