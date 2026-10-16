import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { ExceptionsView } from "@/components/orders/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Exceptions" };

export default function ManagerExceptionsPage({
  searchParams,
}: PageProps<"/manager/exceptions">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Exceptions searchParams={searchParams} />
    </Suspense>
  );
}

async function Exceptions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff(["admin", "manager"]);
  if (staff.role === "admin" || !staff.branchId) redirect("/admin/exceptions");
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader
        title="Exceptions"
        description="Voids, refunds, discounts, price changes and no-sales, with who approved them."
      />
      <ExceptionsView
        branchId={staff.branchId}
        params={await searchParams}
        orderBasePath="/manager/orders"
      />
    </AdminPage>
  );
}
