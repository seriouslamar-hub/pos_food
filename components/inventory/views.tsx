import Link from "next/link";
import { BranchPicker } from "@/components/admin/branch-picker";
import { EmptyState } from "@/components/admin/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDays, dateInZone, formatInZone, isIsoDate } from "@/lib/datetime";
import { requestTime } from "@/lib/devices";
import { formatQuantity, isLowStock, type StockUnit } from "@/lib/inventory";
import { formatAmount } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { InventoryContext } from "./context";
import {
  CountReview,
  PurchaseOrderActions,
  PurchaseOrderForm,
  StockActions,
  StockCountForm,
  type StockIngredient,
} from "./stock-forms";

type Params = Record<string, string | string[] | undefined>;

async function branchAndStock(branchId: string) {
  const supabase = await createClient();
  const [{ data: branch }, { data: ingredients }, { data: stock }] =
    await Promise.all([
      supabase
        .from("branches")
        .select("name, currency_code, timezone")
        .eq("id", branchId)
        .single(),
      supabase
        .from("ingredients")
        .select(
          "id, name, unit, category, cost_per_unit, reorder_level, supplier_id, is_active",
        )
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("branch_stock")
        .select("ingredient_id, quantity_on_hand")
        .eq("branch_id", branchId),
    ]);
  const onHand = new Map(
    (stock ?? []).map((s) => [s.ingredient_id, Number(s.quantity_on_hand)]),
  );
  const list = (ingredients ?? []).map((i) => ({
    ...i,
    reorder_level: Number(i.reorder_level),
    on_hand: onHand.get(i.id) ?? 0,
  }));
  return { supabase, branch, ingredients: list };
}

function SubNav({ ctx, current }: { ctx: InventoryContext; current: string }) {
  const links = [
    ["", "Stock"],
    ["/orders", "Purchase orders"],
    ["/counts", "Counts"],
    ["/reports", "Reports"],
  ];
  return (
    <div className="flex flex-col gap-3">
      {ctx.branches ? (
        <BranchPicker branches={ctx.branches} branchId={ctx.branchId} />
      ) : null}
      <nav aria-label="Stock" className="flex flex-wrap gap-2">
        {links.map(([path, label]) => (
          <Link
            key={path}
            href={ctx.href(path)}
            aria-current={current === path ? "page" : undefined}
            className={buttonVariants({
              variant: current === path ? "default" : "outline",
              size: "lg",
            })}
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Stock on hand, low-stock alerts, waste and transfers. */
export async function StockHubView({ ctx }: { ctx: InventoryContext }) {
  const { supabase, branch, ingredients } = await branchAndStock(ctx.branchId);
  if (!branch) return <EmptyState>That branch doesn&apos;t exist.</EmptyState>;
  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const money = (n: number) => formatAmount(n, branch.currency_code);
  const low = ingredients.filter((i) => isLowStock(i.on_hand, i.reorder_level));
  const value = ingredients.reduce(
    (sum, i) => sum + Math.max(0, Math.round(i.on_hand * i.cost_per_unit)),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <SubNav ctx={ctx} current="" />
      {low.length ? (
        <Alert variant="destructive" data-testid="low-stock-alert">
          <AlertDescription className="text-base">
            Low stock: {low.map((i) => i.name).join(", ")}.{" "}
            <Link href={ctx.href("/orders/new")} className="underline">
              Order more
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          Stock value at cost:{" "}
          <strong className="text-foreground">{money(value)}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          <StockActions
            branchId={ctx.branchId}
            ingredients={ingredients as StockIngredient[]}
            otherBranches={(branches ?? []).filter(
              (b) => b.id !== ctx.branchId,
            )}
          />
        </div>
      </div>
      {ingredients.length === 0 ? (
        <EmptyState>
          No ingredients yet. An admin sets them up under Ingredients.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reorder below</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ingredients.map((i) => {
                const isLow = isLowStock(i.on_hand, i.reorder_level);
                return (
                  <TableRow
                    key={i.id}
                    data-testid="stock-row"
                    data-low={isLow || undefined}
                  >
                    <TableCell className="font-medium">
                      {i.name}
                      {isLow ? (
                        <Badge variant="destructive" className="ml-2">
                          Low
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{i.category ?? "–"}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        isLow && "font-semibold text-destructive",
                      )}
                    >
                      {formatQuantity(i.on_hand, i.unit as StockUnit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(i.reorder_level, i.unit as StockUnit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(
                        Math.max(0, Math.round(i.on_hand * i.cost_per_unit)),
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

const PO_STATUS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  received: "Received",
  cancelled: "Cancelled",
};

export async function PurchaseOrdersView({ ctx }: { ctx: InventoryContext }) {
  const supabase = await createClient();
  const [{ data: branch }, { data: orders }] = await Promise.all([
    supabase
      .from("branches")
      .select("timezone")
      .eq("id", ctx.branchId)
      .single(),
    supabase
      .from("purchase_orders")
      .select(
        "id, status, expected_on, created_at, suppliers(name), purchase_order_lines(id)",
      )
      .eq("branch_id", ctx.branchId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <SubNav ctx={ctx} current="/orders" />
      <div>
        <Link
          href={ctx.href("/orders/new")}
          className={buttonVariants({ size: "lg" })}
        >
          New purchase order
        </Link>
      </div>
      {orders?.length ? (
        <ul className="divide-y rounded-xl border">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={ctx.href(`/orders/${o.id}`)}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted"
                data-testid="po-row"
              >
                <span>
                  <span className="font-medium">
                    {(o.suppliers as { name: string } | null)?.name}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {formatInZone(o.created_at, branch?.timezone ?? "UTC", {
                      dateStyle: "medium",
                    })}{" "}
                    · {o.purchase_order_lines.length} lines
                    {o.expected_on ? ` · expected ${o.expected_on}` : ""}
                  </span>
                </span>
                <Badge
                  variant={o.status === "received" ? "secondary" : "outline"}
                >
                  {PO_STATUS[o.status]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No purchase orders yet.</EmptyState>
      )}
    </div>
  );
}

export async function NewPurchaseOrderView({ ctx }: { ctx: InventoryContext }) {
  const { supabase, branch, ingredients } = await branchAndStock(ctx.branchId);
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (!branch) return <EmptyState>That branch doesn&apos;t exist.</EmptyState>;
  return (
    <div className="flex flex-col gap-5">
      <SubNav ctx={ctx} current="/orders" />
      {suppliers?.length ? (
        <PurchaseOrderForm
          branchId={ctx.branchId}
          ingredients={ingredients as StockIngredient[]}
          suppliers={suppliers}
          currency={branch.currency_code}
          doneHref={ctx.href("/orders/{id}")}
        />
      ) : (
        <EmptyState>Add a supplier first (admins: Suppliers).</EmptyState>
      )}
    </div>
  );
}

export async function PurchaseOrderView({
  ctx,
  orderId,
}: {
  ctx: InventoryContext;
  orderId: string;
}) {
  const supabase = await createClient();
  const [{ data: order }, { data: branch }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(
        "id, status, expected_on, notes, created_at, received_at, suppliers(name), " +
          "purchase_order_lines(ingredient_id, quantity, unit_cost, received_quantity, received_unit_cost, ingredients(name, unit))",
      )
      .eq("id", orderId)
      .eq("branch_id", ctx.branchId)
      .maybeSingle(),
    supabase
      .from("branches")
      .select("currency_code, timezone")
      .eq("id", ctx.branchId)
      .single(),
  ]);
  if (!order || !branch)
    return <EmptyState>Purchase order not found.</EmptyState>;
  type PoLine = {
    ingredient_id: string;
    quantity: number;
    unit_cost: number;
    received_quantity: number | null;
    received_unit_cost: number | null;
    ingredients: { name: string; unit: StockUnit } | null;
  };
  const po = order as unknown as {
    id: string;
    status: string;
    expected_on: string | null;
    notes: string | null;
    created_at: string;
    received_at: string | null;
    suppliers: { name: string } | null;
    purchase_order_lines: PoLine[];
  };
  const money = (n: number) => formatAmount(n, branch.currency_code);
  const lines = po.purchase_order_lines.map((l) => ({
    ingredient_id: l.ingredient_id,
    name: l.ingredients?.name ?? "?",
    unit: (l.ingredients?.unit ?? "pc") as StockUnit,
    quantity: Number(l.quantity),
    unit_cost: l.unit_cost,
    received_quantity:
      l.received_quantity === null ? null : Number(l.received_quantity),
    received_unit_cost: l.received_unit_cost,
  }));
  const total = lines.reduce(
    (s, l) => s + Math.round(l.quantity * l.unit_cost),
    0,
  );
  return (
    <div className="flex flex-col gap-5">
      <SubNav ctx={ctx} current="/orders" />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold">{po.suppliers?.name}</h2>
        <Badge data-testid="po-status">{PO_STATUS[po.status]}</Badge>
        <span className="text-muted-foreground">
          Ordered{" "}
          {formatInZone(po.created_at, branch.timezone, {
            dateStyle: "medium",
          })}
          {po.expected_on ? ` · expected ${po.expected_on}` : ""}
        </span>
      </div>
      {po.notes ? <p>{po.notes}</p> : null}
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ingredient</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Cost each</TableHead>
              <TableHead className="text-right">Arrived</TableHead>
              <TableHead className="text-right">Paid each</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.ingredient_id}>
                <TableCell>{l.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(l.quantity, l.unit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(l.unit_cost)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.received_quantity === null
                    ? "–"
                    : formatQuantity(l.received_quantity, l.unit)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {l.received_unit_cost === null
                    ? "–"
                    : money(l.received_unit_cost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground">
        Order value: <strong className="text-foreground">{money(total)}</strong>
      </p>
      <PurchaseOrderActions
        orderId={po.id}
        status={po.status}
        lines={lines}
        currency={branch.currency_code}
      />
    </div>
  );
}

export async function CountsView({ ctx }: { ctx: InventoryContext }) {
  const { supabase, branch, ingredients } = await branchAndStock(ctx.branchId);
  if (!branch) return <EmptyState>That branch doesn&apos;t exist.</EmptyState>;
  const { data: counts } = await supabase
    .from("stock_counts")
    .select(
      "id, category, status, counted_at, review_note, counted:staff!stock_counts_counted_by_fkey(full_name), " +
        "stock_count_lines(ingredient_id, expected, counted, variance, ingredients(name, unit, cost_per_unit))",
    )
    .eq("branch_id", ctx.branchId)
    .order("counted_at", { ascending: false })
    .limit(20);
  type CountRow = {
    id: string;
    category: string | null;
    status: string;
    counted_at: string;
    review_note: string | null;
    counted: { full_name: string } | null;
    stock_count_lines: {
      ingredient_id: string;
      expected: number;
      counted: number;
      variance: number;
      ingredients: {
        name: string;
        unit: StockUnit;
        cost_per_unit: number;
      } | null;
    }[];
  };
  const money = (n: number) => formatAmount(n, branch.currency_code);
  return (
    <div className="flex flex-col gap-6">
      <SubNav ctx={ctx} current="/counts" />
      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-lg font-semibold">Count stock</h2>
        <StockCountForm
          branchId={ctx.branchId}
          ingredients={ingredients as StockIngredient[]}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Counts</h2>
        {((counts ?? []) as unknown as CountRow[]).map((c) => {
          const lines = c.stock_count_lines.filter(
            (l) => Number(l.variance) !== 0,
          );
          const value = c.stock_count_lines.reduce(
            (s, l) =>
              s +
              Math.round(
                Number(l.variance) * (l.ingredients?.cost_per_unit ?? 0),
              ),
            0,
          );
          return (
            <article
              key={c.id}
              className="flex flex-col gap-3 rounded-xl border p-4"
              data-testid="count-card"
            >
              <div className="flex flex-wrap items-center gap-3">
                <strong>{c.category ?? "Everything"}</strong>
                <Badge
                  variant={c.status === "pending" ? "outline" : "secondary"}
                >
                  {c.status === "pending"
                    ? "Waiting for approval"
                    : c.status === "approved"
                      ? "Approved"
                      : "Rejected"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {formatInZone(c.counted_at, branch.timezone)} by{" "}
                  {c.counted?.full_name ?? "–"} · {c.stock_count_lines.length}{" "}
                  counted · difference {value > 0 ? "+" : ""}
                  {money(value)}
                </span>
              </div>
              {lines.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {lines.map((l) => (
                    <li key={l.ingredient_id}>
                      {l.ingredients?.name}: expected{" "}
                      {formatQuantity(l.expected, l.ingredients?.unit)}, counted{" "}
                      {formatQuantity(l.counted, l.ingredients?.unit)} (
                      <span
                        className={
                          Number(l.variance) < 0 ? "text-destructive" : ""
                        }
                      >
                        {Number(l.variance) > 0 ? "+" : ""}
                        {formatQuantity(l.variance)}
                      </span>
                      )
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Everything matched.
                </p>
              )}
              {c.review_note ? (
                <p className="text-sm">{c.review_note}</p>
              ) : null}
              {c.status === "pending" ? <CountReview countId={c.id} /> : null}
            </article>
          );
        })}
        {counts?.length ? null : <EmptyState>No counts yet.</EmptyState>}
      </section>
    </div>
  );
}

type ReportRow = {
  id: string;
  name: string;
  unit: StockUnit;
  on_hand: number;
  value: number;
  theoretical: number;
  waste: number;
  count_adjust: number;
  received: number;
  transferred: number;
  returned: number;
  actual: number;
};

export async function InventoryReportsView({
  ctx,
  params,
}: {
  ctx: InventoryContext;
  params: Params;
}) {
  const supabase = await createClient();
  const { data: branch } = await supabase
    .from("branches")
    .select("currency_code, timezone")
    .eq("id", ctx.branchId)
    .single();
  if (!branch) return <EmptyState>That branch doesn&apos;t exist.</EmptyState>;
  const today = dateInZone(requestTime(), branch.timezone);
  const to = isIsoDate(params.to) ? params.to : today;
  const from = isIsoDate(params.from) ? params.from : addDays(to, -6);
  const { data, error } = await supabase.rpc("inventory_report", {
    p_branch_id: ctx.branchId,
    p_from: from,
    p_to: to,
  });
  const report = data as {
    ingredients: ReportRow[];
    waste_by_reason: { reason: string; lines: number; value: number }[];
  } | null;
  const money = (n: number) => formatAmount(n, branch.currency_code);
  const active = (report?.ingredients ?? []).filter(
    (r) =>
      Number(r.theoretical) ||
      Number(r.waste) ||
      Number(r.count_adjust) ||
      Number(r.received) ||
      Number(r.transferred),
  );
  const totalValue = (report?.ingredients ?? []).reduce(
    (s, r) => s + Math.max(0, Number(r.value)),
    0,
  );
  return (
    <div className="flex flex-col gap-6">
      <SubNav ctx={ctx} current="/reports" />
      <form className="flex flex-wrap items-end gap-3" aria-label="Dates">
        {ctx.branches ? (
          <input type="hidden" name="branch" value={ctx.branchId} />
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          From
          <Input type="date" name="from" defaultValue={from} className="w-44" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <Input type="date" name="to" defaultValue={to} className="w-44" />
        </label>
        <Button type="submit" variant="outline" size="lg">
          Show
        </Button>
      </form>
      {error ? <EmptyState>{error.message}</EmptyState> : null}
      <p className="text-muted-foreground">
        Stock value now:{" "}
        <strong className="text-foreground">{money(totalValue)}</strong>
      </p>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Theoretical vs actual usage</h2>
        <p className="text-sm text-muted-foreground">
          Theoretical: what the recipes of what was sold used. Actual adds waste
          and stock that went missing (counted short), less refunds put back.
        </p>
        {active.length ? (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">Theoretical</TableHead>
                  <TableHead className="text-right">Waste</TableHead>
                  <TableHead className="text-right">Count difference</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {active.map((r) => (
                  <TableRow key={r.id} data-testid="usage-row">
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(r.theoretical, r.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(r.waste, r.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(r.count_adjust, r.unit)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        Number(r.actual) > Number(r.theoretical) &&
                          "font-semibold text-destructive",
                      )}
                    >
                      {formatQuantity(r.actual, r.unit)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(r.received, r.unit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState>No stock moved in these dates.</EmptyState>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Waste by reason</h2>
        {report?.waste_by_reason.length ? (
          <ul className="flex flex-col gap-1">
            {report.waste_by_reason.map((w) => (
              <li key={w.reason}>
                {w.reason}: {w.lines} {w.lines === 1 ? "line" : "lines"},{" "}
                {money(w.value)} at cost
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No waste recorded.</p>
        )}
      </section>
    </div>
  );
}
