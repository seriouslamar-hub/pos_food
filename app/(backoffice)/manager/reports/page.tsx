import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { reportsContext } from "@/components/reports/context";
import { DashboardView } from "@/components/reports/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage(props: PageProps<"/manager/reports">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Reports {...props} />
    </Suspense>
  );
}

async function Reports(props: PageProps<"/manager/reports">) {
  const staff = await requireStaff(["admin", "manager"]);
  const ctx = await reportsContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Reports" />
      {ctx ? (
        <DashboardView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
