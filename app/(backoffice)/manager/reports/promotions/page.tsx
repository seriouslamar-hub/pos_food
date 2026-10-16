import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { reportsContext } from "@/components/reports/context";
import { PromotionsView } from "@/components/reports/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Promotions report" };

export default function PromotionReportPage(
  props: PageProps<"/manager/reports/promotions">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PromotionReport {...props} />
    </Suspense>
  );
}

async function PromotionReport(
  props: PageProps<"/manager/reports/promotions">,
) {
  const staff = await requireStaff(["admin", "manager"]);
  const ctx = await reportsContext(staff, await props.searchParams);
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader title="Promotions report" />
      {ctx ? (
        <PromotionsView ctx={ctx} />
      ) : (
        <EmptyState>Create a branch first.</EmptyState>
      )}
    </AdminPage>
  );
}
