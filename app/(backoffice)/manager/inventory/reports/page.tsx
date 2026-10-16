import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { inventoryContext } from "@/components/inventory/context";
import { InventoryReportsView } from "@/components/inventory/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Stock reports" };

export default function StockReportsPage(
  props: PageProps<"/manager/inventory/reports">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockReports {...props} />
    </Suspense>
  );
}

async function StockReports(props: PageProps<"/manager/inventory/reports">) {
  const staff = await requireStaff(["admin", "manager"]);
  const params = await props.searchParams;
  const ctx = await inventoryContext(staff, params);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Stock reports" />
      {ctx ? (
        <InventoryReportsView ctx={ctx} params={params} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
