import type { Metadata } from "next";
import { Suspense } from "react";
import { Select } from "@/components/admin/form";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { AvailabilityBoard } from "@/components/menu/availability-board";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth";
import { parseMenu } from "@/lib/menu";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Availability" };

export default function AdminAvailabilityPage({
  searchParams,
}: PageProps<"/admin/availability">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Availability searchParams={searchParams} />
    </Suspense>
  );
}

async function Availability({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const { branch } = await searchParams;
  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (!branches?.length) {
    return (
      <AdminPage>
        <PageHeader title="Availability" />
        <EmptyState>Create a branch first.</EmptyState>
      </AdminPage>
    );
  }
  const branchId =
    typeof branch === "string" && branches.some((b) => b.id === branch)
      ? branch
      : branches[0].id;
  const { data, error } = await supabase.rpc("get_menu", {
    p_branch_id: branchId,
  });

  return (
    <AdminPage>
      <PageHeader
        title="Availability"
        description="Mark items and extras out of stock for one branch. Its tills update within seconds."
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
      {error || !data ? (
        <EmptyState>
          The menu couldn&apos;t be loaded. Refresh to try again.
        </EmptyState>
      ) : (
        <AvailabilityBoard
          key={branchId}
          branchId={branchId}
          initialMenu={parseMenu(data)}
        />
      )}
    </AdminPage>
  );
}
