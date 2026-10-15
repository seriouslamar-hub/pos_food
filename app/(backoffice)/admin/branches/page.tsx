import type { Metadata } from "next";
import Link from "next/link";
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
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Branches />
    </Suspense>
  );
}

async function Branches() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name, timezone, currency_code, is_active")
    .order("name");

  return (
    <AdminPage>
      <PageHeader
        title="Branches"
        description="Each branch has its own staff, tills, timezone and currency."
      >
        <NewButton href="/admin/branches/new">New branch</NewButton>
      </PageHeader>
      <Notice
        messages={{ created: "Branch created.", saved: "Branch saved." }}
      />
      {!branches?.length ? (
        <EmptyState>No branches yet. Create the first one.</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Timezone</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {branches.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <Link
                    href={`/admin/branches/${b.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {b.name}
                  </Link>
                </TableCell>
                <TableCell>{b.timezone}</TableCell>
                <TableCell>{b.currency_code}</TableCell>
                <TableCell>
                  <Badge variant={b.is_active ? "secondary" : "outline"}>
                    {b.is_active ? "Active" : "Inactive"}
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
