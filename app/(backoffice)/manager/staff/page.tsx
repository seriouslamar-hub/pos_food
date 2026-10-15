import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/admin/notice";
import {
  AdminPage,
  EmptyState,
  NewButton,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { Badge } from "@/components/ui/badge";
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

export const metadata: Metadata = { title: "Cashiers" };

export default function CashiersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Cashiers />
    </Suspense>
  );
}

async function Cashiers() {
  const staff = await requireStaff(["admin", "manager"]);
  if (staff.role === "admin" || !staff.branchId) redirect("/admin/staff");

  const supabase = await createClient();
  const [{ data: cashiers }, { data: branch }] = await Promise.all([
    supabase
      .from("staff")
      .select("id, full_name, has_pin, discount_limit_bps, is_active")
      .eq("role", "cashier")
      .eq("branch_id", staff.branchId)
      .order("is_active", { ascending: false })
      .order("full_name"),
    supabase.from("branches").select("name").eq("id", staff.branchId).single(),
  ]);

  return (
    <AdminPage>
      <PageHeader
        title="Cashiers"
        description={`Cashiers at ${branch?.name ?? "your branch"}.`}
      >
        <NewButton href="/manager/staff/new">Add cashier</NewButton>
      </PageHeader>
      <Notice
        messages={{ created: "Cashier added.", saved: "Cashier saved." }}
      />
      {!cashiers?.length ? (
        <EmptyState>No cashiers yet.</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>PIN</TableHead>
              <TableHead>Discount limit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashiers.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    href={`/manager/staff/${c.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {c.full_name}
                  </Link>
                </TableCell>
                <TableCell>{c.has_pin ? "Set" : "Not set"}</TableCell>
                <TableCell>{formatBps(c.discount_limit_bps)}</TableCell>
                <TableCell>
                  <Badge variant={c.is_active ? "secondary" : "outline"}>
                    {c.is_active ? "Active" : "Inactive"}
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
