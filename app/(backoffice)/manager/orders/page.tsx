import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { OrderSearchView } from "@/components/orders/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Orders" };

export default function ManagerOrdersPage({
  searchParams,
}: PageProps<"/manager/orders">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireStaff(["admin", "manager"]);
  if (staff.role === "admin" || !staff.branchId) redirect("/admin/orders");
  return (
    <AdminPage>
      <PageHeader
        title="Orders"
        description="Find an order by day, number, amount or payment reference."
      />
      <OrderSearchView
        branchId={staff.branchId}
        params={await searchParams}
        orderHref={(id) => `/manager/orders/${id}`}
      />
    </AdminPage>
  );
}
