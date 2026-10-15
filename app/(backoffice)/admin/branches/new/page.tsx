import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { currencyOptions, timezoneOptions } from "@/lib/intl-options";
import { getMenuCurrency } from "@/lib/menu.server";
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
  const supabase = await createClient();
  const { count } = await supabase
    .from("branches")
    .select("id", { count: "exact", head: true });
  const menuCurrency = count ? await getMenuCurrency(supabase) : null;
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
        menuCurrency={menuCurrency}
      />
    </AdminPage>
  );
}
