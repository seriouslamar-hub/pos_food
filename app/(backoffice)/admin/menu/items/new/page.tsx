import type { Metadata } from "next";
import { Suspense } from "react";
import {
  AdminPage,
  EmptyState,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { createClient } from "@/lib/supabase/server";
import { ItemForm } from "../item-form";

export const metadata: Metadata = { title: "New menu item" };

export default function NewItemPage({
  searchParams,
}: PageProps<"/admin/menu/items/new">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewItem searchParams={searchParams} />
    </Suspense>
  );
}

async function NewItem({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const { category, type } = await searchParams;
  const supabase = await createClient();
  const [{ data: categories }, { data: stations }, { data: taxes }, currency] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name")
        .order("sort_order")
        .order("name"),
      supabase
        .from("kds_stations")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("taxes").select("tax_category").eq("is_active", true),
      getMenuCurrency(supabase),
    ]);
  const isCombo = type === "combo";

  if (!categories?.length) {
    return (
      <AdminPage>
        <PageHeader
          title="New menu item"
          back={{ href: "/admin/menu", label: "Menu" }}
        />
        <EmptyState>Create a category first.</EmptyState>
      </AdminPage>
    );
  }

  return (
    <AdminPage>
      <PageHeader
        title={isCombo ? "New combo" : "New menu item"}
        description={
          isCombo
            ? "Create the combo, then add its slots (e.g. Side, Drink)."
            : undefined
        }
        back={{ href: "/admin/menu", label: "Menu" }}
      />
      <ItemForm
        currency={currency}
        categories={categories}
        stations={stations ?? []}
        taxCategories={[...new Set((taxes ?? []).map((t) => t.tax_category))]}
        initial={{
          categoryId:
            typeof category === "string" &&
            categories.some((c) => c.id === category)
              ? category
              : categories[0].id,
          type: isCombo ? "combo" : "item",
          name: "",
          shortName: "",
          description: "",
          price: "",
          taxCategory: "standard",
          kdsStationId: "",
          isActive: true,
        }}
      />
    </AdminPage>
  );
}
