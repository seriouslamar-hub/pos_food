import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { inventoryContext } from "@/components/inventory/context";
import { PurchaseOrderView } from "@/components/inventory/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Purchase order" };

export default function PurchaseOrderPage(
  props: PageProps<"/admin/stock/orders/[orderId]">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PurchaseOrder {...props} />
    </Suspense>
  );
}

async function PurchaseOrder(
  props: PageProps<"/admin/stock/orders/[orderId]">,
) {
  const staff = await requireStaff(["admin"]);
  const { orderId } = await props.params;
  const ctx = await inventoryContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Purchase order" />
      {ctx ? (
        <PurchaseOrderView ctx={ctx} orderId={orderId} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
