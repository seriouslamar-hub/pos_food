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
import { buttonVariants } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { createClient } from "@/lib/supabase/server";
import { CategoryList, ItemList, SampleMenuButton } from "./menu-lists";

export const metadata: Metadata = { title: "Menu" };

export default function MenuPage({ searchParams }: PageProps<"/admin/menu">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Menu searchParams={searchParams} />
    </Suspense>
  );
}

async function Menu({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const { category } = await searchParams;
  const supabase = await createClient();
  const [{ data: categories }, { data: items }, currency] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, colour, is_active")
      .order("sort_order")
      .order("name"),
    supabase
      .from("menu_items")
      .select("id, category_id, type, name, base_price, is_active")
      .order("sort_order")
      .order("name"),
    getMenuCurrency(supabase),
  ]);

  const tools = (
    <>
      <Link
        href="/admin/menu/modifiers"
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        Modifier groups
      </Link>
      <Link
        href="/admin/menu/stations"
        className={buttonVariants({ variant: "outline", size: "lg" })}
      >
        Kitchen stations
      </Link>
    </>
  );

  if (!categories?.length) {
    return (
      <AdminPage>
        <PageHeader
          title="Menu"
          description="Categories, items, modifiers and combos for every branch."
        >
          {tools}
        </PageHeader>
        <EmptyState>
          <div className="flex flex-col items-center gap-4">
            <p>
              The menu is empty. Start from a sample fast-food menu you can
              edit, or build your own.
            </p>
            <SampleMenuButton />
            <Link
              href="/admin/menu/categories/new"
              className="text-sm underline underline-offset-4"
            >
              Or create your first category
            </Link>
          </div>
        </EmptyState>
      </AdminPage>
    );
  }

  const selected = categories.find((c) => c.id === category) ?? categories[0];
  const categoryItems = (items ?? []).filter(
    (i) => i.category_id === selected.id,
  );

  return (
    <AdminPage className="max-w-6xl">
      <PageHeader
        title="Menu"
        description={`One menu for every branch, priced in ${currency}. Drag the handles to change the order on the till.`}
      >
        {tools}
      </PageHeader>
      <Notice
        messages={{
          "category-saved": "Category saved.",
          "item-saved": "Item saved.",
        }}
      />
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <section className="flex flex-col gap-3" aria-label="Categories">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Categories</h2>
            <Link
              href="/admin/menu/categories/new"
              className="text-sm underline underline-offset-4"
            >
              New category
            </Link>
          </div>
          <CategoryList categories={categories} selectedId={selected.id} />
        </section>
        <section className="flex flex-col gap-3" aria-label="Items">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {selected.name}{" "}
              <Link
                href={`/admin/menu/categories/${selected.id}`}
                className="ml-2 text-sm font-normal underline underline-offset-4"
              >
                Edit category
              </Link>
            </h2>
            <div className="flex gap-2">
              <NewButton href={`/admin/menu/items/new?category=${selected.id}`}>
                New item
              </NewButton>
              <Link
                href={`/admin/menu/items/new?category=${selected.id}&type=combo`}
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                New combo
              </Link>
            </div>
          </div>
          {categoryItems.length ? (
            <ItemList
              key={selected.id}
              items={categoryItems}
              currency={currency}
            />
          ) : (
            <EmptyState>No items in this category yet.</EmptyState>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
