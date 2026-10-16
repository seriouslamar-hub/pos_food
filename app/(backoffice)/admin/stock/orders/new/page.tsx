import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { inventoryContext } from "@/components/inventory/context";
import { NewPurchaseOrderView } from "@/components/inventory/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "New purchase order" };

export default function NewPurchaseOrderPage(
  props: PageProps<"/admin/stock/orders/new">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewPurchaseOrder {...props} />
    </Suspense>
  );
}

async function NewPurchaseOrder(props: PageProps<"/admin/stock/orders/new">) {
  const staff = await requireStaff(["admin"]);
  const ctx = await inventoryContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="New purchase order" />
      {ctx ? (
        <NewPurchaseOrderView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
