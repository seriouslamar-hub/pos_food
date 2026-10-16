import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { reportsContext } from "@/components/reports/context";
import { DiscountsView } from "@/components/reports/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Discount report" };

export default function DiscountReportPage(
  props: PageProps<"/admin/reports/discounts">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DiscountReport {...props} />
    </Suspense>
  );
}

async function DiscountReport(props: PageProps<"/admin/reports/discounts">) {
  const staff = await requireStaff(["admin"]);
  const ctx = await reportsContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Discount report" />
      {ctx ? (
        <DiscountsView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
