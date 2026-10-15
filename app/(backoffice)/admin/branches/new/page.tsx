import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { currencyOptions, timezoneOptions } from "@/lib/intl-options";
import { BranchForm } from "../branch-form";

export const metadata: Metadata = { title: "New branch" };

export default function NewBranchPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewBranch />
    </Suspense>
  );
}

async function NewBranch() {
  await requireStaff(["admin"]);
  return (
    <AdminPage>
      <PageHeader
        title="New branch"
        back={{ href: "/admin/branches", label: "Branches" }}
      />
      <BranchForm
        initial={{
          name: "",
          address: "",
          phone: "",
          timezone: "",
          currencyCode: "",
          receiptHeader: "",
          receiptFooter: "",
          isActive: true,
        }}
        timezones={timezoneOptions()}
        currencies={currencyOptions()}
      />
    </AdminPage>
  );
}
