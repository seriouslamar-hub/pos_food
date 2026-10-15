import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The currency menu prices are entered in. There is one master menu, so
 * branches are expected to share a currency; the first branch created (the
 * oldest active one) sets it, so it never changes as branches are added.
 * USD until there is a branch.
 */
export async function getMenuCurrency(supabase: Client): Promise<string> {
  const { data } = await supabase
    .from("branches")
    .select("currency_code")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.currency_code ?? "USD";
}
