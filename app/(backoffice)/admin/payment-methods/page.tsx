import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PaymentMethodsEditor } from "./payment-methods-editor";

export const metadata: Metadata = { title: "Payment methods" };

export default function PaymentMethodsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PaymentMethods />
    </Suspense>
  );
}

async function PaymentMethods() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const { data: methods } = await supabase
    .from("payment_methods")
    .select("id, type, name, is_enabled, requires_reference, sort_order")
    .order("sort_order")
    .order("name");

  return (
    <AdminPage>
      <PageHeader
        title="Payment methods"
        description="What the till accepts. Methods that need a reference ask the cashier for the card slip or mobile money transaction number."
      />
      <PaymentMethodsEditor methods={methods ?? []} />
    </AdminPage>
  );
}
