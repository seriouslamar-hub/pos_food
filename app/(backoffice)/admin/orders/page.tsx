import type { Metadata } from "next";
import { Suspense } from "react";
import { adminBranch, BranchPicker } from "@/components/admin/branch-picker";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { OrderSearchView } from "@/components/orders/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage({
  searchParams,
}: PageProps<"/admin/orders">) {
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
  await requireStaff(["admin"]);
  const params = await searchParams;
  const chosen = await adminBranch(params.branch);
  return (
    <AdminPage>
      <PageHeader
        title="Orders"
        description="Find an order by day, number, amount or payment reference."
      />
      {chosen ? (
        <>
          <BranchPicker branches={chosen.branches} branchId={chosen.branchId} />
          <OrderSearchView
            branchId={chosen.branchId}
            params={params}
            hidden={{ branch: chosen.branchId }}
            orderHref={(id) => `/admin/orders/${id}`}
          />
        </>
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
