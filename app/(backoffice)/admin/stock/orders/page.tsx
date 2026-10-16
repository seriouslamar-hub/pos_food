import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { inventoryContext } from "@/components/inventory/context";
import { PurchaseOrdersView } from "@/components/inventory/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Purchase orders" };

export default function PurchaseOrdersPage(
  props: PageProps<"/admin/stock/orders">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PurchaseOrders {...props} />
    </Suspense>
  );
}

async function PurchaseOrders(props: PageProps<"/admin/stock/orders">) {
  const staff = await requireStaff(["admin"]);
  const ctx = await inventoryContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Purchase orders" />
      {ctx ? (
        <PurchaseOrdersView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
