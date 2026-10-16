import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import {
  IngredientsManager,
  LoadSampleInventory,
} from "@/components/inventory/setup";
import { requireStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Ingredients" };

export default function IngredientsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Ingredients />
    </Suspense>
  );
}

async function Ingredients() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const [{ data: ingredients }, { data: suppliers }, currency] =
    await Promise.all([
      supabase
        .from("ingredients")
        .select(
          "id, name, unit, category, cost_per_unit, reorder_level, supplier_id, is_active",
        )
        .order("name"),
      supabase
        .from("suppliers")
        .select("id, name, phone, email, is_active")
        .order("name"),
      getMenuCurrency(supabase),
    ]);
  return (
    <AdminPage>
      <PageHeader
        title="Ingredients"
        description="What branches keep in stock, what it costs, and when to reorder."
      />
      {ingredients?.length ? null : (
        <EmptyState>
          <div className="flex flex-col items-center gap-3">
            No ingredients yet. Add your own, or start with ingredients and
            recipes for the sample menu.
            <LoadSampleInventory />
          </div>
        </EmptyState>
      )}
      <IngredientsManager
        ingredients={(ingredients ?? []).map((i) => ({
          ...i,
          reorder_level: Number(i.reorder_level),
        }))}
        suppliers={suppliers ?? []}
        currency={currency}
      />
    </AdminPage>
  );
}
