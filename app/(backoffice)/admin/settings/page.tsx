import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { readSetting, SETTINGS, type SettingValue } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage({
  searchParams,
}: PageProps<"/admin/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff(["admin"]);
  const { branch } = await searchParams;
  const supabase = await createClient();
  const [{ data: branches }, { data: rows }] = await Promise.all([
    supabase.from("branches").select("id, name, currency_code").order("name"),
    supabase
      .from("settings")
      .select("branch_id, key, value")
      .in(
        "key",
        SETTINGS.map((s) => s.key),
      ),
  ]);
  const branchId =
    typeof branch === "string" && branches?.some((b) => b.id === branch)
      ? branch
      : null;

  // Money settings are typed in the branch's currency (the main currency for
  // the defaults).
  const currency = branchId
    ? (branches?.find((b) => b.id === branchId)?.currency_code ?? "USD")
    : await getMenuCurrency(supabase);

  const defaults: Record<string, SettingValue> = {};
  const overrides: Record<string, SettingValue> = {};
  for (const def of SETTINGS) {
    for (const row of rows ?? []) {
      if (row.key !== def.key) continue;
      const value = readSetting(def, row.value);
      if (value === null) continue;
      if (row.branch_id === null) defaults[def.key] = value;
      else if (row.branch_id === branchId) overrides[def.key] = value;
    }
  }

  return (
    <AdminPage>
      <PageHeader
        title="Settings"
        description="Defaults for every branch, with optional values per branch."
      />
      <SettingsForm
        key={branchId ?? "defaults"}
        branchId={branchId}
        branches={branches ?? []}
        currency={currency}
        defaults={defaults}
        overrides={overrides}
      />
    </AdminPage>
  );
}
