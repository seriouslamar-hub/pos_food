import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { TaxForm } from "../tax-form";

export const metadata: Metadata = { title: "New tax" };

export default function NewTaxPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewTax />
    </Suspense>
  );
}

async function NewTax() {
  await requireStaff(["admin"]);
  return (
    <AdminPage>
      <PageHeader
        title="New tax"
        back={{ href: "/admin/taxes", label: "Taxes" }}
      />
      <TaxForm
        initial={{
          name: "",
          ratePercent: "",
          isInclusive: false,
          taxCategory: "standard",
          sortOrder: "",
          isActive: true,
        }}
      />
    </AdminPage>
  );
}
