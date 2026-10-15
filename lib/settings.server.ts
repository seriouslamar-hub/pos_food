import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { readSetting, SETTINGS, type SettingValue } from "./settings";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * One setting's effective value: the branch override if there is one, then
 * the global default, then the built-in fallback.
 */
export async function getSetting(
  supabase: Client,
  key: string,
  branchId: string | null,
): Promise<SettingValue> {
  const def = SETTINGS.find((s) => s.key === key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  const { data } = await supabase
    .from("settings")
    .select("branch_id, value")
    .eq("key", key);
  const row =
    (branchId ? data?.find((r) => r.branch_id === branchId) : undefined) ??
    data?.find((r) => r.branch_id === null);
  return (row ? readSetting(def, row.value) : null) ?? def.fallback;
}
