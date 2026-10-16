import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { suggestDeviceCode } from "@/lib/devices";
import { createClient } from "@/lib/supabase/server";
import { DeviceForm } from "../device-form";

export const metadata: Metadata = { title: "New device" };

export default function NewDevicePage({
  searchParams,
}: PageProps<"/admin/devices/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewDevice searchParams={searchParams} />
    </Suspense>
  );
}

async function NewDevice({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const { branch } = await searchParams;
  const supabase = await createClient();
  const [{ data: branches }, { data: devices }] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name")
      .is("training_for", null)
      .eq("is_active", true)
      .order("name"),
    supabase.from("devices").select("id, branch_id, code"),
  ]);
  const existing = (devices ?? []).map((d) => ({
    id: d.id,
    branchId: d.branch_id,
    code: d.code,
  }));
  const branchId =
    (typeof branch === "string" && branches?.some((b) => b.id === branch)
      ? branch
      : null) ?? (branches?.length === 1 ? branches[0].id : "");

  return (
    <AdminPage>
      <PageHeader
        title="New device"
        back={{ href: "/admin/devices", label: "Devices" }}
      />
      <DeviceForm
        branches={branches ?? []}
        existing={existing}
        initial={{
          branchId,
          name: "",
          type: "till",
          code: branchId
            ? suggestDeviceCode(
                "till",
                existing
                  .filter((d) => d.branchId === branchId)
                  .map((d) => d.code),
              )
            : "",
          station: "",
          isActive: true,
        }}
      />
    </AdminPage>
  );
}
