import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { bpsToPercentInput } from "@/lib/percent";
import { getSetting } from "@/lib/settings.server";
import { createClient } from "@/lib/supabase/server";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "New staff member" };

export default function NewStaffPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewStaff />
    </Suspense>
  );
}

async function NewStaff() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const [{ data: branches }, defaultDiscount] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    getSetting(supabase, "staff.default_cashier_discount_bps", null),
  ]);

  return (
    <AdminPage>
      <PageHeader
        title="New staff member"
        back={{ href: "/admin/staff", label: "Staff" }}
      />
      <StaffForm
        branches={branches ?? []}
        initial={{
          fullName: "",
          role: "cashier",
          branchId: branches?.length === 1 ? branches[0].id : "",
          email: "",
          phone: "",
          discountPercent: bpsToPercentInput(defaultDiscount as number),
          isActive: true,
          pin: "",
        }}
      />
    </AdminPage>
  );
}
