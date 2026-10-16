import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { reportsContext } from "@/components/reports/context";
import { SalesView } from "@/components/reports/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Sales report" };

export default function SalesReportPage(
  props: PageProps<"/admin/reports/sales">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesReport {...props} />
    </Suspense>
  );
}

async function SalesReport(props: PageProps<"/admin/reports/sales">) {
  const staff = await requireStaff(["admin"]);
  const ctx = await reportsContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Sales report" />
      {ctx ? (
        <SalesView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
