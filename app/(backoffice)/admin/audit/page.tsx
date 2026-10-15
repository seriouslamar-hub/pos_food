import type { Metadata } from "next";
import { Suspense } from "react";
import { AUDIT_ENTITIES, AuditLog } from "@/components/admin/audit-log";
import { Select } from "@/components/admin/form";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };

export default function AdminAuditPage({
  searchParams,
}: PageProps<"/admin/audit">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Audit searchParams={searchParams} />
    </Suspense>
  );
}

async function Audit({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const params = await searchParams;
  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .order("name");
  const branch =
    typeof params.branch === "string" &&
    branches?.some((b) => b.id === params.branch)
      ? params.branch
      : undefined;
  const entity =
    typeof params.entity === "string" &&
    AUDIT_ENTITIES.some((e) => e.value === params.entity)
      ? params.entity
      : undefined;

  return (
    <AdminPage className="max-w-6xl">
      <PageHeader
        title="Audit log"
        description="Every change and sensitive action, newest first. Entries can't be edited or deleted."
      />
      <form
        className="flex flex-wrap items-end gap-3"
        aria-label="Filter the audit log"
      >
        <label className="flex flex-col gap-1 text-sm">
          Branch
          <Select name="branch" defaultValue={branch ?? ""} className="w-48">
            <option value="">All branches</option>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Type
          <Select name="entity" defaultValue={entity ?? ""} className="w-48">
            <option value="">Everything</option>
            {AUDIT_ENTITIES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="outline" size="lg">
          Filter
        </Button>
      </form>
      <AuditLog branchId={branch} entity={entity} />
    </AdminPage>
  );
}
