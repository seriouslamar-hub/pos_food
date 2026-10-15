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
import { formatBps } from "@/lib/percent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Taxes" };

export default function TaxesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Taxes />
    </Suspense>
  );
}

async function Taxes() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const { data: taxes } = await supabase
    .from("taxes")
    .select("id, name, rate_bps, is_inclusive, tax_category, is_active")
    .order("tax_category")
    .order("sort_order")
    .order("name");

  return (
    <AdminPage>
      <PageHeader
        title="Taxes"
        description="Every active tax in an item's tax category applies to it, so one item can carry several taxes."
      >
        <NewButton href="/admin/taxes/new">New tax</NewButton>
      </PageHeader>
      <Notice messages={{ created: "Tax added.", saved: "Tax saved." }} />
      {!taxes?.length ? (
        <EmptyState>
          No taxes yet. Prices will be charged without tax until you add one.
        </EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Prices</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {taxes.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link
                    href={`/admin/taxes/${t.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {t.name}
                  </Link>
                </TableCell>
                <TableCell>{formatBps(t.rate_bps)}</TableCell>
                <TableCell className="font-mono">{t.tax_category}</TableCell>
                <TableCell>
                  {t.is_inclusive ? "Included" : "Added on top"}
                </TableCell>
                <TableCell>
                  <Badge variant={t.is_active ? "secondary" : "outline"}>
                    {t.is_active ? "Active" : "Inactive"}
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
