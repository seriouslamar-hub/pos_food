import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { inventoryContext } from "@/components/inventory/context";
import { CountsView } from "@/components/inventory/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Stock counts" };

export default function StockCountsPage(
  props: PageProps<"/manager/inventory/counts">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockCounts {...props} />
    </Suspense>
  );
}

async function StockCounts(props: PageProps<"/manager/inventory/counts">) {
  const staff = await requireStaff(["admin", "manager"]);
  const ctx = await inventoryContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Stock counts" />
      {ctx ? (
        <CountsView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
