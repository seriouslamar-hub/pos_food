import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { BusinessDay } from "@/components/day/business-day";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Business day" };

export default function ManagerDayPage({
  searchParams,
}: PageProps<"/manager/day">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Day searchParams={searchParams} />
    </Suspense>
  );
}

async function Day({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff(["admin", "manager"]);
  if (staff.role === "admin" || !staff.branchId) redirect("/admin/day");
  const { day } = await searchParams;

  return (
    <AdminPage>
      <PageHeader
        title="Business day"
        description="Open and close the day, check each cashier's cash, and print the Z report."
      />
      <BusinessDay
        branchId={staff.branchId}
        selectedDayId={typeof day === "string" ? day : undefined}
        dayHref={(id) => `/manager/day?day=${id}`}
      />
    </AdminPage>
  );
}
