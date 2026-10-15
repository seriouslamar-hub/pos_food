import type { Metadata } from "next";
import { Suspense } from "react";
import { Select } from "@/components/admin/form";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { BusinessDay } from "@/components/day/business-day";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Business day" };

export default function AdminDayPage({
  searchParams,
}: PageProps<"/admin/day">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Day searchParams={searchParams} />
    </Suspense>
  );
}

async function Day({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const { branch, day } = await searchParams;
  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (!branches?.length) {
    return (
      <AdminPage>
        <PageHeader title="Business day" />
        <EmptyState>Create a branch first.</EmptyState>
      </AdminPage>
    );
  }
  const branchId =
    typeof branch === "string" && branches.some((b) => b.id === branch)
      ? branch
      : branches[0].id;

  return (
    <AdminPage>
      <PageHeader
        title="Business day"
        description="Open and close a branch's day, check each cashier's cash, and print the Z report."
      />
      <form
        className="flex flex-wrap items-end gap-3"
        aria-label="Choose a branch"
      >
        <label className="flex flex-col gap-1 text-sm">
          Branch
          <Select name="branch" defaultValue={branchId} className="w-56">
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="outline" size="lg">
          Show
        </Button>
      </form>
      <BusinessDay
        branchId={branchId}
        selectedDayId={typeof day === "string" ? day : undefined}
        dayHref={(id) => `/admin/day?branch=${branchId}&day=${id}`}
      />
    </AdminPage>
  );
}
