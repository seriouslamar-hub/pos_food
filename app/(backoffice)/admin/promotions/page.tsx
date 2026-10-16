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
import { dateInZone } from "@/lib/datetime";
import { requestTime } from "@/lib/devices";
import { getMenuCurrency } from "@/lib/menu.server";
import { formatAmount } from "@/lib/money";
import { formatBps } from "@/lib/percent";
import {
  describeWhen,
  PROMOTION_TYPES,
  type PromotionRow,
} from "@/lib/promotion-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Promotions" };

export default function PromotionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Promotions />
    </Suspense>
  );
}

function describeDeal(p: PromotionRow, currency: string) {
  switch (p.type) {
    case "percent_off":
      return `${formatBps(p.value)} off`;
    case "amount_off":
      return `${formatAmount(p.value, currency)} off`;
    case "fixed_price":
      return `${formatAmount(p.value, currency)} each`;
    default:
      return `Buy ${p.buy_quantity} get ${p.get_quantity}${p.get_discount_bps === 10000 ? " free" : ` ${formatBps(p.get_discount_bps)} off`}`;
  }
}

async function Promotions() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const [{ data }, { data: uses }, currency] = await Promise.all([
    supabase
      .from("promotions")
      .select("*")
      .order("is_active", { ascending: false })
      .order("priority", { ascending: false })
      .order("name"),
    supabase.from("promotion_redemptions").select("promotion_id"),
    getMenuCurrency(supabase),
  ]);
  const count = new Map<string, number>();
  for (const u of uses ?? [])
    count.set(u.promotion_id, (count.get(u.promotion_id) ?? 0) + 1);
  const today = dateInZone(requestTime(), "UTC");
  const promotions = (data ?? []) as unknown as (PromotionRow & {
    id: string;
  })[];
  return (
    <AdminPage className="max-w-6xl">
      <PageHeader
        title="Promotions"
        description="Deals the tills apply by themselves (or with a coupon code), worked out again by the server on every order."
      >
        <NewButton href="/admin/promotions/new">New promotion</NewButton>
      </PageHeader>
      <Notice
        messages={{ created: "Promotion added.", saved: "Promotion saved." }}
      />
      {promotions.length === 0 ? (
        <EmptyState>No promotions yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Deal</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Coupon</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {promotions.map((p) => {
                const ended = p.end_date !== null && p.end_date < today;
                const used = count.get(p.id) ?? 0;
                return (
                  <TableRow key={p.id} data-testid="promotion-row">
                    <TableCell>
                      <Link
                        href={`/admin/promotions/${p.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {PROMOTION_TYPES.find((t) => t.value === p.type)?.label}
                        {p.stackable ? " · stacks" : ""} · priority {p.priority}
                      </span>
                    </TableCell>
                    <TableCell>{describeDeal(p, currency)}</TableCell>
                    <TableCell>{describeWhen(p)}</TableCell>
                    <TableCell className="font-mono">
                      {p.coupon_code ?? "–"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {used}
                      {p.max_uses ? ` / ${p.max_uses}` : ""}
                    </TableCell>
                    <TableCell>
                      {!p.is_active ? (
                        <Badge variant="outline">Off</Badge>
                      ) : ended ? (
                        <Badge variant="outline">Ended</Badge>
                      ) : p.max_uses && used >= p.max_uses ? (
                        <Badge variant="outline">Used up</Badge>
                      ) : (
                        <Badge>Running</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminPage>
  );
}
