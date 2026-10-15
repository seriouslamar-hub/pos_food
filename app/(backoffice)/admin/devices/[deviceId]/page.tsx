import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { deviceStatus, requestTime } from "@/lib/devices";
import { createClient } from "@/lib/supabase/server";
import { DeviceForm } from "../device-form";
import { DeviceAccessPanel } from "../setup-code-panel";

export const metadata: Metadata = { title: "Edit device" };

export default function EditDevicePage({
  params,
}: PageProps<"/admin/devices/[deviceId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditDevice params={params} />
    </Suspense>
  );
}

async function EditDevice({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  await requireStaff(["admin"]);
  const { deviceId } = await params;
  const supabase = await createClient();
  const [{ data: device }, { data: branches }, { data: devices }] =
    await Promise.all([
      supabase
        .from("devices")
        .select(
          "id, branch_id, name, type, code, station, is_active, last_seen_at, auth_user_id",
        )
        .eq("id", deviceId)
        .maybeSingle(),
      supabase.from("branches").select("id, name").order("name"),
      supabase.from("devices").select("id, branch_id, code"),
    ]);
  if (!device) notFound();
  const status = deviceStatus(device.last_seen_at, requestTime());

  return (
    <AdminPage>
      <PageHeader
        title={device.name}
        description={device.auth_user_id ? status.label : "Not set up yet"}
        back={{ href: "/admin/devices", label: "Devices" }}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Setup</h2>
        <DeviceAccessPanel
          deviceId={device.id}
          deviceName={device.name}
          isActive={device.is_active}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Details</h2>
        <DeviceForm
          deviceId={device.id}
          branches={branches ?? []}
          existing={(devices ?? []).map((d) => ({
            id: d.id,
            branchId: d.branch_id,
            code: d.code,
          }))}
          initial={{
            branchId: device.branch_id,
            name: device.name,
            type: device.type,
            code: device.code,
            station: device.station ?? "",
            isActive: device.is_active,
          }}
        />
      </section>
    </AdminPage>
  );
}
