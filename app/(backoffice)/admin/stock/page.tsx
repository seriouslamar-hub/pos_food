import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { inventoryContext } from "@/components/inventory/context";
import { StockHubView } from "@/components/inventory/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage(props: PageProps<"/admin/stock">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Stock {...props} />
    </Suspense>
  );
}

async function Stock(props: PageProps<"/admin/stock">) {
  const staff = await requireStaff(["admin"]);
  const ctx = await inventoryContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Stock" />
      {ctx ? (
        <StockHubView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
