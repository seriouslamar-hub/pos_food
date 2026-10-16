import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { promotionToForm, type PromotionRow } from "@/lib/promotion-form";
import { createClient } from "@/lib/supabase/server";
import { promotionOptions } from "../options";
import { PromotionForm } from "../promotion-form";

export const metadata: Metadata = { title: "Promotion" };

export default function EditPromotionPage(
  props: PageProps<"/admin/promotions/[promotionId]">,
) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditPromotion {...props} />
    </Suspense>
  );
}

async function EditPromotion(
  props: PageProps<"/admin/promotions/[promotionId]">,
) {
  await requireStaff(["admin"]);
  const { promotionId } = await props.params;
  const supabase = await createClient();
  const [{ data }, options] = await Promise.all([
    supabase.from("promotions").select("*").eq("id", promotionId).maybeSingle(),
    promotionOptions(),
  ]);
  return (
    <AdminPage>
      <PageHeader
        title={data?.name ?? "Promotion"}
        back={{ href: "/admin/promotions", label: "Promotions" }}
      />
      {data ? (
        <PromotionForm
          promotionId={data.id}
          initial={promotionToForm(
            data as unknown as PromotionRow,
            options.currency,
          )}
          {...options}
        />
      ) : (
        <EmptyState>That promotion doesn&apos;t exist.</EmptyState>
      )}
    </AdminPage>
  );
}
