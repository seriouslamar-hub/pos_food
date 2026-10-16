"use client";

import { useState } from "react";
import { ManagerOverride } from "@/components/manager-override";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatInZone } from "@/lib/datetime";
import type { MenuPaymentMethod } from "@/lib/menu";
import { formatAmount, parseMoney } from "@/lib/money";
import {
  ORDER_STATUS_LABELS,
  parseOrderSummary,
  type OrderSummary,
} from "@/lib/orders";
import { can } from "@/lib/permissions";
import { getPrinterDriver, type PaperWidth } from "@/lib/printing";
import { createClient } from "@/lib/supabase/client";
import { isSessionEndedError, rpcErrorMessage } from "@/lib/till";
import { useTillSession } from "@/lib/till-session";
import { useFieldIds } from "@/lib/use-field-ids";
import { cn } from "@/lib/utils";

type FoundOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: OrderSummary["status"];
  total: number;
  staff_name: string | null;
};

type AuditEntry = {
  at: string;
  action: string;
  actor_name: string | null;
  approver_name: string | null;
  reason: string | null;
};

const AUDIT_LABELS: Record<string, string> = {
  "order.create": "Order taken",
  "order.paid": "Paid",
  "order.sent_to_kitchen": "Sent to kitchen unpaid",
  "order.discount": "Discount",
  "order.price_override": "Price changed",
  "order.void": "Items voided",
  "order.refund": "Refund",
};

const VOID_REASONS = ["Customer changed mind", "Wrong item", "Quality issue"];
const REFUND_REASONS = [
  "Customer changed mind",
  "Wrong item",
  "Quality issue",
  "Cold food",
];

type RpcError = { code?: string; message: string };

/** The till's Orders button: find an order, then reprint, refund or void. */
export function OrderLookup({
  branchId,
  currency,
  timezone,
  businessDate,
  paymentMethods,
  paperWidth,
  onTakePayment,
  disabled,
}: {
  branchId: string;
  currency: string;
  timezone: string;
  businessDate: string;
  paymentMethods: MenuPaymentMethod[];
  paperWidth: PaperWidth;
  /** Opens the payment screen for an unpaid order; returns a problem or null. */
  onTakePayment: (orderId: string) => Promise<string | null>;
  /** Needs the connection. */
  disabled?: boolean;
}) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(businessDate);
  const [number, setNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [found, setFound] = useState<FoundOrder[] | null>(null);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [trail, setTrail] = useState<AuditEntry[] | null>(null);
  const [action, setAction] = useState<"refund" | "void" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (value: number) => formatAmount(value, currency);
  const canSeeHistory = can(session.permissions, "audit.view_branch");

  function failed(rpcError: RpcError) {
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    setError(rpcErrorMessage(rpcError));
  }

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    let minor: number | undefined;
    if (amount.trim()) {
      try {
        minor = parseMoney(amount, currency);
      } catch {
        setError("Enter the amount like 12.50.");
        return;
      }
    }
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("search_orders", {
      p_branch_id: branchId,
      p_business_date: date || undefined,
      p_number: number.trim() || undefined,
      p_amount: minor,
      p_reference: reference.trim() || undefined,
    });
    setBusy(false);
    if (rpcError) return failed(rpcError);
    setFound((data as FoundOrder[] | null) ?? []);
  }

  async function show(orderId: string) {
    setError(null);
    setBusy(true);
    const [{ data, error: rpcError }, history] = await Promise.all([
      supabase.rpc("get_order", { p_order_id: orderId }),
      canSeeHistory
        ? supabase.rpc("order_audit_trail", {
            p_order_id: orderId,
            p_session_id: session.sessionId,
          })
        : Promise.resolve({ data: null, error: null }),
    ]);
    setBusy(false);
    if (rpcError) return failed(rpcError);
    setOrder(parseOrderSummary(data));
    setTrail((history.data as AuditEntry[] | null) ?? null);
  }

  return (
    <>
      <Button
        size="lg"
        variant="outline"
        className="h-12 px-4 text-base"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setOrder(null);
          setMessage(null);
          void search();
        }}
      >
        Orders
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="flex max-h-[94dvh] w-[min(60rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {order ? `Order ${order.order_number}` : "Find an order"}
            </DialogTitle>
            <DialogDescription>
              {order
                ? `${ORDER_STATUS_LABELS[order.status]} · taken by ${order.staff_name ?? "–"} at ${formatInZone(order.created_at, timezone, { timeStyle: "short" })}`
                : "By number, amount or payment reference."}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}
          {message ? (
            <Alert aria-live="polite">
              <AlertDescription
                className="text-base"
                data-testid="lookup-message"
              >
                {message}
              </AlertDescription>
            </Alert>
          ) : null}

          {order ? (
            <OrderDetail
              order={order}
              trail={trail}
              money={money}
              timezone={timezone}
              onBack={() => {
                setOrder(null);
                setMessage(null);
                void search();
              }}
              onReprint={() =>
                void getPrinterDriver().print(
                  [{ kind: "receipt", order, copy: true }],
                  paperWidth,
                )
              }
              onRefund={() => setAction("refund")}
              onVoid={() => setAction("void")}
              onTakePayment={async () => {
                const problem = await onTakePayment(order.id);
                if (problem) setError(problem);
                else setOpen(false);
              }}
            />
          ) : (
            <>
              <form
                onSubmit={search}
                className="grid grid-cols-2 gap-3 md:grid-cols-5"
                aria-label="Search orders"
              >
                <label
                  htmlFor={fid("date")}
                  className="flex flex-col gap-1 text-sm"
                >
                  Business day
                  <Input
                    id={fid("date")}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-12"
                  />
                </label>
                <label
                  htmlFor={fid("number")}
                  className="flex flex-col gap-1 text-sm"
                >
                  Order number
                  <Input
                    id={fid("number")}
                    inputMode="numeric"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    className="h-12"
                  />
                </label>
                <label
                  htmlFor={fid("amount")}
                  className="flex flex-col gap-1 text-sm"
                >
                  Amount
                  <Input
                    id={fid("amount")}
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-12"
                  />
                </label>
                <label
                  htmlFor={fid("reference")}
                  className="flex flex-col gap-1 text-sm"
                >
                  Payment reference
                  <Input
                    id={fid("reference")}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="h-12"
                  />
                </label>
                <Button
                  type="submit"
                  size="touch"
                  className="self-end"
                  disabled={busy}
                >
                  Search
                </Button>
              </form>
              {found === null ? (
                <p className="text-muted-foreground">Searching…</p>
              ) : found.length === 0 ? (
                <p className="text-muted-foreground">No orders found.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {found.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => void show(o.id)}
                        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left hover:bg-muted"
                        data-testid="found-order"
                      >
                        <span>
                          <strong className="text-lg">
                            Order {o.order_number}
                          </strong>
                          <span className="block text-sm text-muted-foreground">
                            {formatInZone(o.created_at, timezone, {
                              timeStyle: "short",
                            })}{" "}
                            · {o.staff_name ?? "–"}
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Badge variant="secondary">
                            {ORDER_STATUS_LABELS[o.status]}
                          </Badge>
                          <span className="text-lg tabular-nums">
                            {money(o.total)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {order && action === "refund" ? (
            <RefundDialog
              order={order}
              paymentMethods={paymentMethods}
              money={money}
              onClose={() => setAction(null)}
              onDone={(updated, refundId) => {
                setAction(null);
                setOrder(updated);
                const refund = updated.refunds.find((r) => r.id === refundId);
                setMessage(
                  `Refunded ${money(refund?.amount ?? 0)} by ${refund?.method_name ?? ""}.`,
                );
                const driver = getPrinterDriver();
                if (refund?.method === "cash") void driver.openDrawer();
                void driver.print(
                  [{ kind: "refund", order: updated, refundId }],
                  paperWidth,
                );
                if (canSeeHistory) void show(updated.id);
              }}
            />
          ) : null}
          {order && action === "void" ? (
            <VoidDialog
              order={order}
              money={money}
              onClose={() => setAction(null)}
              onDone={(updated, count) => {
                setAction(null);
                setOrder(updated);
                setMessage(
                  `${count === 1 ? "1 item" : `${count} items`} voided.${updated.status === "voided" ? " The order is voided." : ""}`,
                );
                if (canSeeHistory) void show(updated.id);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrderDetail({
  order,
  trail,
  money,
  timezone,
  onBack,
  onReprint,
  onRefund,
  onVoid,
  onTakePayment,
}: {
  order: OrderSummary;
  trail: AuditEntry[] | null;
  money: (amount: number) => string;
  timezone: string;
  onBack: () => void;
  onReprint: () => void;
  onRefund: () => void;
  onVoid: () => void;
  onTakePayment: () => void;
}) {
  const refundable =
    order.paid_at !== null &&
    order.status !== "refunded" &&
    order.status !== "voided" &&
    order.total - order.refunded_total > 0;
  const unpaid = order.paid_at === null && order.status !== "voided";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="touch" onClick={onBack}>
          Back to search
        </Button>
        <Button variant="outline" size="touch" onClick={onReprint}>
          Reprint receipt
        </Button>
        {refundable ? (
          <Button variant="outline" size="touch" onClick={onRefund}>
            Refund
          </Button>
        ) : null}
        {unpaid ? (
          <>
            <Button variant="outline" size="touch" onClick={onVoid}>
              Void items
            </Button>
            <Button size="touch" onClick={onTakePayment}>
              Take payment
            </Button>
          </>
        ) : null}
      </div>

      <ul className="divide-y rounded-xl border" aria-label="Lines">
        {order.lines.map((l) => (
          <li
            key={l.id}
            className="flex items-start justify-between gap-3 px-4 py-2"
            data-testid="detail-line"
          >
            <span
              className={cn(
                l.status === "voided" && !l.refunded_at && "line-through",
              )}
            >
              {l.quantity} × {l.name}
              {l.components.length ? (
                <span className="block text-sm text-muted-foreground">
                  {l.components.map((c) => c.name).join(", ")}
                </span>
              ) : null}
              {l.line_discount ? (
                <span className="block text-sm text-muted-foreground">
                  Discount −{money(l.line_discount)}
                  {l.discount ? ` (${l.discount.reason})` : ""}
                </span>
              ) : null}
              {l.price_override_from !== null ? (
                <span className="block text-sm text-muted-foreground">
                  Price changed from {money(l.price_override_from)}
                </span>
              ) : null}
              {l.refunded_at ? (
                <Badge variant="outline">Refunded</Badge>
              ) : l.status === "voided" ? (
                <span className="block text-sm text-destructive">
                  Voided: {l.void_reason}
                </span>
              ) : null}
            </span>
            <span className="tabular-nums">{money(l.line_total)}</span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-base sm:grid-cols-4">
        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-semibold tabular-nums">{money(order.total)}</dd>
        <dt className="text-muted-foreground">Paid</dt>
        <dd className="tabular-nums">
          {order.payments.length
            ? order.payments
                .map(
                  (p) =>
                    `${p.method_name} ${money(p.amount)}${p.reference ? ` (${p.reference})` : ""}`,
                )
                .join(", ")
            : "Not paid"}
        </dd>
        {order.refunds.length ? (
          <>
            <dt className="text-muted-foreground">Refunded</dt>
            <dd className="tabular-nums">
              {order.refunds
                .map((r) => `${r.method_name} ${money(r.amount)} (${r.reason})`)
                .join(", ")}
            </dd>
          </>
        ) : null}
      </dl>

      {trail ? (
        <section className="flex flex-col gap-2" aria-label="History">
          <h3 className="font-semibold">History</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {trail.map((t, i) => (
              <li key={i} data-testid="history-entry">
                {formatInZone(t.at, timezone, { timeStyle: "short" })} ·{" "}
                {AUDIT_LABELS[t.action] ?? t.action} by {t.actor_name ?? "–"}
                {t.approver_name ? `, approved by ${t.approver_name}` : ""}
                {t.reason ? ` · ${t.reason}` : ""}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function ReasonPicker({
  id,
  reasons,
  value,
  onChange,
}: {
  id: string;
  reasons: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        Reason
      </label>
      <div className="flex flex-wrap gap-2">
        {reasons.map((r) => (
          <Button
            key={r}
            type="button"
            variant={value === r ? "default" : "tab"}
            className="h-11 px-3"
            onClick={() => onChange(r)}
          >
            {r}
          </Button>
        ))}
      </div>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Or type another reason"
        className="h-12 text-base"
        maxLength={200}
        autoComplete="off"
      />
    </div>
  );
}

/** Money back on a paid order: all that's left, or chosen lines. */
function RefundDialog({
  order,
  paymentMethods,
  money,
  onClose,
  onDone,
}: {
  order: OrderSummary;
  paymentMethods: MenuPaymentMethod[];
  money: (amount: number) => string;
  onClose: () => void;
  onDone: (order: OrderSummary, refundId: string) => void;
}) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  // One id for this refund, so sending it again never refunds twice.
  const [id] = useState(() => crypto.randomUUID());
  const refundable = order.lines.filter(
    (l) => l.status !== "voided" && !l.refunded_at,
  );
  const [whole, setWhole] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const paidBy = order.payments[0]?.method;
  const [methodId, setMethodId] = useState(
    () =>
      (
        paymentMethods.find((m) => m.type === paidBy) ??
        paymentMethods.find((m) => m.type === "cash") ??
        paymentMethods[0]
      )?.id ?? "",
  );
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [returnToStock, setReturnToStock] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const method = paymentMethods.find((m) => m.id === methodId);
  const amount = whole
    ? order.total - order.refunded_total
    : refundable
        .filter((l) => chosen.includes(l.id))
        .reduce((sum, l) => sum + l.line_total, 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!whole && chosen.length === 0)
      return setError("Choose the items to refund.");
    if (!method) return setError("Choose how the money goes back.");
    if (
      method.type !== "cash" &&
      method.requires_reference &&
      !reference.trim()
    )
      return setError(`${method.name} refunds need a reference number.`);
    if (!reason.trim()) return setError("Give a reason for the refund.");
    if (can(session.permissions, "order.refund")) void refund();
    else setApprovalOpen(true);
  }

  async function refund(overrideId?: string) {
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("refund_order", {
      p_session_id: session.sessionId,
      p_refund: {
        id,
        order_id: order.id,
        line_ids: whole ? null : chosen,
        payment_method_id: methodId,
        reference: reference.trim() || null,
        reason: reason.trim(),
        return_to_stock: returnToStock,
        override_id: overrideId ?? null,
        client_created_at: new Date().toISOString(),
      },
    });
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      return;
    }
    onDone(parseOrderSummary(data), id);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(40rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Refund order {order.order_number}
          </DialogTitle>
          <DialogDescription>
            Lines the kitchen hasn&apos;t made yet are stopped too.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <div
            role="radiogroup"
            aria-label="What to refund"
            className="flex gap-2"
          >
            {(
              [
                [true, "Everything left"],
                [false, "Some items"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={whole === value}
                onClick={() => setWhole(value)}
                className={cn(
                  "min-h-12 flex-1 rounded-xl text-base font-medium",
                  whole === value
                    ? "bg-foreground text-background"
                    : "bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {!whole ? (
            <ul className="flex flex-col gap-2">
              {refundable.map((l) => (
                <li key={l.id}>
                  <label className="flex min-h-12 items-center gap-3 rounded-xl border px-3">
                    <Checkbox
                      checked={chosen.includes(l.id)}
                      onCheckedChange={(checked) =>
                        setChosen((c) =>
                          checked === true
                            ? [...c, l.id]
                            : c.filter((x) => x !== l.id),
                        )
                      }
                      aria-label={`Refund ${l.quantity} × ${l.name}`}
                    />
                    <span className="flex-1">
                      {l.quantity} × {l.name}
                    </span>
                    <span className="tabular-nums">{money(l.line_total)}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Money goes back by</span>
            <div
              role="radiogroup"
              aria-label="Refund method"
              className="grid auto-cols-fr grid-flow-col gap-2"
            >
              {paymentMethods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={m.id === methodId}
                  onClick={() => setMethodId(m.id)}
                  className={cn(
                    "min-h-12 rounded-xl px-2 text-base font-medium",
                    m.id === methodId
                      ? "bg-foreground text-background"
                      : "bg-muted",
                  )}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>
          {method && method.type !== "cash" ? (
            <label
              htmlFor={fid("reference")}
              className="flex flex-col gap-1 text-sm font-medium"
            >
              Reference{method.requires_reference ? "" : " (optional)"}
              <Input
                id={fid("reference")}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="h-12 text-base"
                autoComplete="off"
              />
            </label>
          ) : null}
          <ReasonPicker
            id={fid("reason")}
            reasons={REFUND_REASONS}
            value={reason}
            onChange={setReason}
          />
          <label className="flex min-h-12 items-center gap-3 rounded-xl border px-3 text-base">
            <Checkbox
              checked={returnToStock}
              onCheckedChange={(checked) => setReturnToStock(checked === true)}
            />
            Put the items back in stock (not made, or sealed)
          </label>
          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="submit"
            size="touch"
            className="h-16 text-xl"
            disabled={busy || amount <= 0}
          >
            {busy ? "Refunding…" : `Refund ${money(amount)}`}
          </Button>
        </form>
        <ManagerOverride
          open={approvalOpen}
          onOpenChange={setApprovalOpen}
          permission="order.refund"
          actionLabel={`Refunding ${money(amount)}`}
          reason={reason.trim()}
          onApproved={(approval) => void refund(approval.overrideId)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Voiding lines of an order that isn't paid. */
function VoidDialog({
  order,
  money,
  onClose,
  onDone,
}: {
  order: OrderSummary;
  money: (amount: number) => string;
  onClose: () => void;
  onDone: (order: OrderSummary, count: number) => void;
}) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const lines = order.lines.filter((l) => l.status !== "voided");
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sent =
    order.sent_to_kitchen_at !== null ||
    lines.some((l) => chosen.includes(l.id) && l.status !== "pending");
  const own = order.staff_id === session.staff.id;
  const allowed = can(
    session.permissions,
    !sent && own ? "order.void_unsent" : "order.void_sent",
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (chosen.length === 0) return setError("Choose the items to void.");
    if (!reason.trim()) return setError("Give a reason for the void.");
    if (allowed) void voidItems();
    else setApprovalOpen(true);
  }

  async function voidItems(overrideId?: string) {
    setBusy(true);
    const { data, error: rpcError } = await supabase.rpc("void_order_items", {
      p_session_id: session.sessionId,
      p_order_id: order.id,
      p_item_ids: chosen,
      p_reason: reason.trim(),
      p_override_id: overrideId,
    });
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      return;
    }
    onDone(parseOrderSummary(data), chosen.length);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(40rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">
            Void items on order {order.order_number}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? "The kitchen has this order, so a manager approves the void."
              : "Voided items come off the order."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <ul className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l.id}>
                <label className="flex min-h-12 items-center gap-3 rounded-xl border px-3">
                  <Checkbox
                    checked={chosen.includes(l.id)}
                    onCheckedChange={(checked) =>
                      setChosen((c) =>
                        checked === true
                          ? [...c, l.id]
                          : c.filter((x) => x !== l.id),
                      )
                    }
                    aria-label={`Void ${l.quantity} × ${l.name}`}
                  />
                  <span className="flex-1">
                    {l.quantity} × {l.name}
                  </span>
                  <span className="tabular-nums">{money(l.line_total)}</span>
                </label>
              </li>
            ))}
          </ul>
          <ReasonPicker
            id={fid("reason")}
            reasons={VOID_REASONS}
            value={reason}
            onChange={setReason}
          />
          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" size="touch" disabled={busy}>
            {busy
              ? "Voiding…"
              : `Void ${chosen.length === 1 ? "1 item" : `${chosen.length} items`}`}
          </Button>
        </form>
        <ManagerOverride
          open={approvalOpen}
          onOpenChange={setApprovalOpen}
          permission="order.void_sent"
          actionLabel="Voiding these items"
          reason={reason.trim()}
          onApproved={(approval) => void voidItems(approval.overrideId)}
        />
      </DialogContent>
    </Dialog>
  );
}
