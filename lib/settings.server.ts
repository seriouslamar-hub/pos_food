import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { effectiveSetting, type SettingValue } from "./settings";

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
  const { data } = await supabase
    .from("settings")
    .select("key, branch_id, value")
    .eq("key", key);
  return effectiveSetting(key, data, branchId);
}
