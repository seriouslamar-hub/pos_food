import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/admin/notice";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { PinPanel } from "@/components/staff/pin-panel";
import { requireStaff } from "@/lib/auth";
import { bpsToPercentInput } from "@/lib/percent";
import { createClient } from "@/lib/supabase/server";
import { CashierForm } from "../cashier-form";

export const metadata: Metadata = { title: "Edit cashier" };

export default function EditCashierPage({
  params,
}: PageProps<"/manager/staff/[staffId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditCashier params={params} />
    </Suspense>
  );
}

async function EditCashier({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const staff = await requireStaff(["admin", "manager"]);
  const { staffId } = await params;
  if (staff.role === "admin" || !staff.branchId)
    redirect(`/admin/staff/${staffId}`);

  const supabase = await createClient();
  // RLS only shows managers their own branch, so another branch's cashier is "not found".
  const { data: cashier } = await supabase
    .from("staff")
    .select("id, full_name, phone, has_pin, discount_limit_bps, is_active")
    .eq("id", staffId)
    .eq("role", "cashier")
    .eq("branch_id", staff.branchId)
    .maybeSingle();
  if (!cashier) notFound();

  return (
    <AdminPage>
      <PageHeader
        title={cashier.full_name}
        back={{ href: "/manager/staff", label: "Cashiers" }}
      />
      <Notice
        messages={{
          "pin-not-set":
            "Saved, but the PIN wasn't set (it may already be in use). Choose another below.",
        }}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Details</h2>
        <CashierForm
          staffId={cashier.id}
          initial={{
            fullName: cashier.full_name,
            phone: cashier.phone ?? "",
            discountPercent: bpsToPercentInput(cashier.discount_limit_bps),
            isActive: cashier.is_active,
            pin: "",
          }}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Till PIN</h2>
        <PinPanel
          staffId={cashier.id}
          hasPin={cashier.has_pin ?? false}
          isActive={cashier.is_active}
        />
      </section>
    </AdminPage>
  );
}
