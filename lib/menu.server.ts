import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The currency menu prices are entered in. There is one master menu, so all
 * branches are expected to share a currency; this picks the one most active
 * branches use (USD if there are no branches yet).
 */
export async function getMenuCurrency(supabase: Client): Promise<string> {
  const { data } = await supabase
    .from("branches")
    .select("currency_code")
    .eq("is_active", true);
  const counts = new Map<string, number>();
  for (const row of data ?? [])
    counts.set(row.currency_code, (counts.get(row.currency_code) ?? 0) + 1);
  let best = "USD";
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}
