import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { RecipesManager, type RecipeOwner } from "@/components/inventory/setup";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Recipes" };

export default function RecipesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Recipes />
    </Suspense>
  );
}

async function Recipes() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const [
    { data: items },
    { data: modifiers },
    { data: recipes },
    { data: ingredients },
  ] = await Promise.all([
    supabase
      .from("menu_items")
      .select("id, name, type, is_active, categories(name, sort_order)")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("modifiers")
      .select("id, name, is_active, modifier_groups(name)")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("recipes")
      .select("menu_item_id, modifier_id, ingredient_id, quantity"),
    supabase
      .from("ingredients")
      .select(
        "id, name, unit, category, cost_per_unit, reorder_level, supplier_id, is_active",
      )
      .eq("is_active", true)
      .order("name"),
  ]);
  const linesFor = (key: "menu_item_id" | "modifier_id", id: string) =>
    (recipes ?? [])
      .filter((r) => r[key] === id)
      .map((r) => ({
        ingredient_id: r.ingredient_id,
        quantity: Number(r.quantity),
      }));
  const owners: RecipeOwner[] = [
    ...(items ?? []).map((i) => ({
      kind: "item" as const,
      id: i.id,
      name: i.name,
      group: (i.categories as { name: string } | null)?.name ?? "Menu",
      lines: linesFor("menu_item_id", i.id),
    })),
    ...(modifiers ?? []).map((m) => ({
      kind: "modifier" as const,
      id: m.id,
      name: `${(m.modifier_groups as { name: string } | null)?.name ?? ""}: ${m.name}`,
      group: "Choices (modifiers)",
      lines: linesFor("modifier_id", m.id),
    })),
  ];
  return (
    <AdminPage>
      <PageHeader
        title="Recipes"
        description="What each menu item and choice uses. Paid orders take these out of stock."
      />
      {ingredients?.length ? (
        <RecipesManager
          owners={owners}
          ingredients={ingredients.map((i) => ({
            ...i,
            reorder_level: Number(i.reorder_level),
          }))}
        />
      ) : (
        <EmptyState>Add ingredients first.</EmptyState>
      )}
    </AdminPage>
  );
}
