import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Select } from "@/components/admin/form";
import { Notice } from "@/components/admin/notice";
import {
  AdminPage,
  EmptyState,
  NewButton,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireStaff } from "@/lib/auth";
import { formatBps } from "@/lib/percent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

const ROLE_LABELS = {
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
} as const;

export default function StaffPage({ searchParams }: PageProps<"/admin/staff">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StaffList searchParams={searchParams} />
    </Suspense>
  );
}

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function StaffList({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const params = await searchParams;
  const branch = one(params.branch) ?? "";
  const role = one(params.role) ?? "";
  const status = one(params.status) ?? "active";

  const supabase = await createClient();
  let query = supabase
    .from("staff")
    .select(
      "id, full_name, role, branch_id, email, auth_user_id, has_pin, is_active, discount_limit_bps",
    )
    .order("full_name");
  if (branch === "none") query = query.is("branch_id", null);
  else if (branch) query = query.eq("branch_id", branch);
  if (role === "admin" || role === "manager" || role === "cashier")
    query = query.eq("role", role);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);

  const [{ data: staff }, { data: branches }] = await Promise.all([
    query,
    supabase.from("branches").select("id, name").order("name"),
  ]);
  const branchName = new Map((branches ?? []).map((b) => [b.id, b.name]));

  return (
    <AdminPage>
      <PageHeader
        title="Staff"
        description="Admins and managers sign in with email. Cashiers use a PIN on the till."
      >
        <NewButton href="/admin/staff/new">New staff member</NewButton>
      </PageHeader>
      <Notice
        messages={{
          created: "Staff member added.",
          saved: "Staff member saved.",
        }}
      />

      <form
        className="flex flex-wrap items-end gap-3"
        aria-label="Filter staff"
      >
        <label className="flex flex-col gap-1 text-sm">
          Branch
          <Select name="branch" defaultValue={branch} className="w-48">
            <option value="">All branches</option>
            <option value="none">Head office (no branch)</option>
            {(branches ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Role
          <Select name="role" defaultValue={role} className="w-36">
            <option value="">All roles</option>
            <option value="admin">Admins</option>
            <option value="manager">Managers</option>
            <option value="cashier">Cashiers</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <Select name="status" defaultValue={status} className="w-32">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </label>
        <Button type="submit" variant="outline" size="lg">
          Filter
        </Button>
      </form>

      {!staff?.length ? (
        <EmptyState>No staff match these filters.</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Signs in with</TableHead>
              <TableHead>Discount limit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link
                    href={`/admin/staff/${s.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {s.full_name}
                  </Link>
                </TableCell>
                <TableCell>{ROLE_LABELS[s.role]}</TableCell>
                <TableCell>
                  {s.branch_id ? branchName.get(s.branch_id) : "Head office"}
                </TableCell>
                <TableCell className="text-sm">
                  {[s.auth_user_id ? s.email : null, s.has_pin ? "PIN" : null]
                    .filter(Boolean)
                    .join(" · ") || "Nothing yet"}
                </TableCell>
                <TableCell>{formatBps(s.discount_limit_bps)}</TableCell>
                <TableCell>
                  <Badge variant={s.is_active ? "secondary" : "outline"}>
                    {s.is_active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </AdminPage>
  );
}
