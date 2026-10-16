import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { emptyPromotion } from "@/lib/promotion-form";
import { promotionOptions } from "../options";
import { PromotionForm } from "../promotion-form";

export const metadata: Metadata = { title: "New promotion" };

export default function NewPromotionPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewPromotion />
    </Suspense>
  );
}

async function NewPromotion() {
  await requireStaff(["admin"]);
  const options = await promotionOptions();
  return (
    <AdminPage>
      <PageHeader
        title="New promotion"
        back={{ href: "/admin/promotions", label: "Promotions" }}
      />
      <PromotionForm initial={emptyPromotion()} {...options} />
    </AdminPage>
  );
}
