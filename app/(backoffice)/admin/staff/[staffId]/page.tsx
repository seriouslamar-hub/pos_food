import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/admin/notice";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { LoginPanel } from "@/components/staff/login-panel";
import { PinPanel } from "@/components/staff/pin-panel";
import { requireStaff } from "@/lib/auth";
import { bpsToPercentInput } from "@/lib/percent";
import { createClient } from "@/lib/supabase/server";
import { StaffForm } from "../staff-form";

export const metadata: Metadata = { title: "Edit staff member" };

export default function EditStaffPage({
  params,
}: PageProps<"/admin/staff/[staffId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditStaff params={params} />
    </Suspense>
  );
}

async function EditStaff({ params }: { params: Promise<{ staffId: string }> }) {
  await requireStaff(["admin"]);
  const { staffId } = await params;
  const supabase = await createClient();
  const [{ data: staff }, { data: branches }] = await Promise.all([
    supabase
      .from("staff")
      .select(
        "id, full_name, role, branch_id, email, phone, auth_user_id, has_pin, discount_limit_bps, is_active",
      )
      .eq("id", staffId)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("id, name")
      .is("training_for", null)
      .order("name"),
  ]);
  if (!staff) notFound();

  return (
    <AdminPage>
      <PageHeader
        title={staff.full_name}
        back={{ href: "/admin/staff", label: "Staff" }}
      />
      <Notice
        messages={{
          "pin-not-set":
            "Saved, but the PIN wasn't set (it may already be in use). Choose another below.",
        }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Details</h2>
        <StaffForm
          staffId={staff.id}
          branches={branches ?? []}
          initial={{
            fullName: staff.full_name,
            role: staff.role,
            branchId: staff.branch_id ?? "",
            email: staff.email ?? "",
            phone: staff.phone ?? "",
            discountPercent: bpsToPercentInput(staff.discount_limit_bps),
            isActive: staff.is_active,
            pin: "",
          }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Till PIN</h2>
        <PinPanel
          staffId={staff.id}
          hasPin={staff.has_pin ?? false}
          isActive={staff.is_active}
        />
      </section>

      {staff.role !== "cashier" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Back-office login</h2>
          <LoginPanel
            staffId={staff.id}
            hasLogin={Boolean(staff.auth_user_id)}
            email={staff.email}
          />
        </section>
      ) : null}
    </AdminPage>
  );
}
