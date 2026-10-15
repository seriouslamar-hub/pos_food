import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AUDIT_ENTITIES, AuditLog } from "@/components/admin/audit-log";
import { Select } from "@/components/admin/form";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Audit log" };

export default function ManagerAuditPage({
  searchParams,
}: PageProps<"/manager/audit">) {
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
  const staff = await requireStaff(["admin", "manager"]);
  if (staff.role === "admin" || !staff.branchId) redirect("/admin/audit");
  const params = await searchParams;
  const entity =
    typeof params.entity === "string" &&
    AUDIT_ENTITIES.some((e) => e.value === params.entity)
      ? params.entity
      : undefined;

  return (
    <AdminPage className="max-w-6xl">
      <PageHeader
        title="Audit log"
        description="Changes and sensitive actions in your branch, newest first."
      />
      <form
        className="flex flex-wrap items-end gap-3"
        aria-label="Filter the audit log"
      >
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
      <AuditLog branchId={staff.branchId} entity={entity} />
    </AdminPage>
  );
}
