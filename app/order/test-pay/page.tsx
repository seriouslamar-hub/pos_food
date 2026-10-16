import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { formatAmount } from "@/lib/money";
import { onlineProvider, testSignature } from "@/lib/payments/online";

export const metadata = { title: "Test payment" };

/** The local test provider's checkout page (never in production). */
export default function TestPayPage(props: PageProps<"/order/test-pay">) {
  return (
    <Suspense>
      <TestPay {...props} />
    </Suspense>
  );
}

async function TestPay(props: PageProps<"/order/test-pay">) {
  if (onlineProvider()?.name !== "test") notFound();
  const q = await props.searchParams;
  const reference = String(q.reference ?? "");
  const amount = Number(q.amount ?? 0);
  const currency = String(q.currency ?? "USD");
  const callback = String(q.callback ?? "/order");

  async function pay() {
    "use server";
    const body = JSON.stringify({ reference, amount, currency });
    const origin = new URL(callback).origin;
    await fetch(`${origin}/api/payments/webhook/test`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-signature": testSignature(body),
      },
      body,
    });
    redirect(callback);
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Test payment</h1>
      <p className="text-muted-foreground">
        This page stands in for the payment provider on the local stack.
        Reference {reference}.
      </p>
      <p className="text-3xl font-bold">{formatAmount(amount, currency)}</p>
      <form action={pay}>
        <Button type="submit" size="lg" className="w-full">
          Pay {formatAmount(amount, currency)}
        </Button>
      </form>
    </main>
  );
}
