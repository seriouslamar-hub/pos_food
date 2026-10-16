import type { Metadata } from "next";
import { Suspense } from "react";
import { adminBranch, BranchPicker } from "@/components/admin/branch-picker";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { ExceptionsView } from "@/components/orders/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Exceptions" };

export default function AdminExceptionsPage({
  searchParams,
}: PageProps<"/admin/exceptions">) {
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
  await requireStaff(["admin"]);
  const params = await searchParams;
  const chosen = await adminBranch(params.branch);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader
        title="Exceptions"
        description="Voids, refunds, discounts, price changes and no-sales, with who approved them."
      />
      {chosen ? (
        <>
          <BranchPicker branches={chosen.branches} branchId={chosen.branchId} />
          <ExceptionsView
            branchId={chosen.branchId}
            params={params}
            hidden={{ branch: chosen.branchId }}
            orderBasePath="/admin/orders"
          />
        </>
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
