import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StationsEditor } from "./stations-editor";

export const metadata: Metadata = { title: "Kitchen stations" };

export default function StationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Stations />
    </Suspense>
  );
}

async function Stations() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const { data: stations } = await supabase
    .from("kds_stations")
    .select("id, name, is_active")
    .order("sort_order")
    .order("name");

  return (
    <AdminPage>
      <PageHeader
        title="Kitchen stations"
        description="Where items are prepared, e.g. Fryer, Grill, Drinks. Kitchen screens show one station or all of them."
        back={{ href: "/admin/menu", label: "Menu" }}
      />
      <StationsEditor stations={stations ?? []} />
    </AdminPage>
  );
}
