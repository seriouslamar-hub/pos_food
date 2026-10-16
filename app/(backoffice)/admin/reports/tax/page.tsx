import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { reportsContext } from "@/components/reports/context";
import { TaxView } from "@/components/reports/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Tax report" };

export default function TaxReportPage(props: PageProps<"/admin/reports/tax">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TaxReport {...props} />
    </Suspense>
  );
}

async function TaxReport(props: PageProps<"/admin/reports/tax">) {
  const staff = await requireStaff(["admin"]);
  const ctx = await reportsContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Tax report" />
      {ctx ? (
        <TaxView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
