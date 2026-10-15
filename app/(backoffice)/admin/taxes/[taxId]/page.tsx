import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { bpsToPercentInput } from "@/lib/percent";
import { createClient } from "@/lib/supabase/server";
import { TaxForm } from "../tax-form";

export const metadata: Metadata = { title: "Edit tax" };

export default function EditTaxPage({
  params,
}: PageProps<"/admin/taxes/[taxId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditTax params={params} />
    </Suspense>
  );
}

async function EditTax({ params }: { params: Promise<{ taxId: string }> }) {
  await requireStaff(["admin"]);
  const { taxId } = await params;
  const supabase = await createClient();
  const { data: tax } = await supabase
    .from("taxes")
    .select(
      "id, name, rate_bps, is_inclusive, tax_category, sort_order, is_active",
    )
    .eq("id", taxId)
    .maybeSingle();
  if (!tax) notFound();

  return (
    <AdminPage>
      <PageHeader
        title={tax.name}
        back={{ href: "/admin/taxes", label: "Taxes" }}
      />
      <TaxForm
        taxId={tax.id}
        initial={{
          name: tax.name,
          ratePercent: bpsToPercentInput(tax.rate_bps),
          isInclusive: tax.is_inclusive,
          taxCategory: tax.tax_category,
          sortOrder: String(tax.sort_order),
          isActive: tax.is_active,
        }}
      />
    </AdminPage>
  );
}
