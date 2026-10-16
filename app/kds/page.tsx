import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { KdsApp } from "@/components/kds/kds-app";
import { getSignedInUser } from "@/lib/auth";
import { resolveStation } from "@/lib/kitchen";
import { deviceHome } from "@/lib/routes";
import { effectiveSetting } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Kitchen display" };

export default function KdsPage({ searchParams }: PageProps<"/kds">) {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">
          Loading the kitchen screen…
        </div>
      }
    >
      <Kds searchParams={searchParams} />
    </Suspense>
  );
}

async function Kds({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSignedInUser();
  if (!user?.device) redirect("/device/setup");
  if (user.device.type !== "kds") redirect(deviceHome(user.device.type));
  const { station } = await searchParams;

  const supabase = await createClient();
  const branchId = user.device.branchId;
  const [{ data: stations }, { data: rows }] = await Promise.all([
    supabase
      .from("kds_stations")
      .select("id, name")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("settings")
      .select("key, branch_id, value")
      .in("key", [
        "kds.ticket_warn_minutes",
        "kds.ticket_late_minutes",
        "kds.sound",
      ]),
  ]);
  const chosen = resolveStation(
    stations ?? [],
    typeof station === "string" ? station : user.device.station,
  );
  const setting = (key: string) => effectiveSetting(key, rows, branchId);

  return (
    <KdsApp
      branchId={branchId}
      deviceName={user.device.name}
      station={chosen}
      warnMinutes={Number(setting("kds.ticket_warn_minutes"))}
      lateMinutes={Number(setting("kds.ticket_late_minutes"))}
      sound={setting("kds.sound") === true}
    />
  );
}
