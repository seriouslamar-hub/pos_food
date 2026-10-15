import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { currencyOptions, timezoneOptions } from "@/lib/intl-options";
import { createClient } from "@/lib/supabase/server";
import { BranchForm } from "../branch-form";
import { LogoUploader } from "../logo-uploader";

export const metadata: Metadata = { title: "Edit branch" };

export default function EditBranchPage({
  params,
}: PageProps<"/admin/branches/[branchId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditBranch params={params} />
    </Suspense>
  );
}

async function EditBranch({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  await requireStaff(["admin"]);
  const { branchId } = await params;
  const supabase = await createClient();
  const { data: branch } = await supabase
    .from("branches")
    .select(
      "id, name, address, phone, timezone, currency_code, receipt_header, receipt_footer, logo_url, is_active",
    )
    .eq("id", branchId)
    .maybeSingle();
  if (!branch) notFound();

  return (
    <AdminPage>
      <PageHeader
        title={branch.name}
        back={{ href: "/admin/branches", label: "Branches" }}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Logo</h2>
        <LogoUploader branchId={branch.id} logoUrl={branch.logo_url} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Details</h2>
        <BranchForm
          branchId={branch.id}
          initial={{
            name: branch.name,
            address: branch.address ?? "",
            phone: branch.phone ?? "",
            timezone: branch.timezone,
            currencyCode: branch.currency_code,
            receiptHeader: branch.receipt_header ?? "",
            receiptFooter: branch.receipt_footer ?? "",
            isActive: branch.is_active,
          }}
          timezones={timezoneOptions(branch.timezone)}
          currencies={currencyOptions()}
        />
      </section>
    </AdminPage>
  );
}
