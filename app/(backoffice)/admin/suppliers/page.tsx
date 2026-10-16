import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { SuppliersManager } from "@/components/inventory/setup";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Suppliers />
    </Suspense>
  );
}

async function Suppliers() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("suppliers")
    .select("id, name, phone, email, is_active")
    .order("name");
  return (
    <AdminPage>
      <PageHeader
        title="Suppliers"
        description="Who branches order ingredients from."
      />
      <SuppliersManager suppliers={data ?? []} />
    </AdminPage>
  );
}
