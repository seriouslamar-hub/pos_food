import "server-only";
import { getMenuCurrency } from "@/lib/menu.server";
import { createClient } from "@/lib/supabase/server";

/** What the promotion form chooses from: items, categories and branches. */
export async function promotionOptions() {
  const supabase = await createClient();
  const [{ data: items }, { data: categories }, { data: branches }, currency] =
    await Promise.all([
      supabase
        .from("menu_items")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("categories")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("branches")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
      getMenuCurrency(supabase),
    ]);
  const opts = (rows: { id: string; name: string }[] | null) =>
    (rows ?? []).map((r) => ({ value: r.id, label: r.name }));
  return {
    currency,
    items: opts(items),
    categories: opts(categories),
    branches: opts(branches),
  };
}
