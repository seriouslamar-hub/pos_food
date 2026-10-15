import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { bpsToPercentInput } from "@/lib/percent";
import { getSetting } from "@/lib/settings.server";
import { createClient } from "@/lib/supabase/server";
import { CashierForm } from "../cashier-form";

export const metadata: Metadata = { title: "Add cashier" };

export default function NewCashierPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewCashier />
    </Suspense>
  );
}

async function NewCashier() {
  const staff = await requireStaff(["admin", "manager"]);
  if (staff.role === "admin" || !staff.branchId) redirect("/admin/staff/new");
  const supabase = await createClient();
  const defaultDiscount = await getSetting(
    supabase,
    "staff.default_cashier_discount_bps",
    staff.branchId,
  );

  return (
    <AdminPage>
      <PageHeader
        title="Add cashier"
        back={{ href: "/manager/staff", label: "Cashiers" }}
      />
      <CashierForm
        initial={{
          fullName: "",
          phone: "",
          discountPercent: bpsToPercentInput(defaultDiscount as number),
          isActive: true,
          pin: "",
        }}
      />
    </AdminPage>
  );
}
