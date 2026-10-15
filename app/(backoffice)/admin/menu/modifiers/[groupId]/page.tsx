import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/admin/notice";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { createClient } from "@/lib/supabase/server";
import { GroupForm } from "../group-form";
import { ModifiersEditor } from "../modifiers-editor";

export const metadata: Metadata = { title: "Edit modifier group" };

export default function EditGroupPage({
  params,
}: PageProps<"/admin/menu/modifiers/[groupId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditGroup params={params} />
    </Suspense>
  );
}

async function EditGroup({ params }: { params: Promise<{ groupId: string }> }) {
  await requireStaff(["admin"]);
  const { groupId } = await params;
  const supabase = await createClient();
  const [{ data: group }, { data: modifiers }, { data: stations }, currency] =
    await Promise.all([
      supabase
        .from("modifier_groups")
        .select("id, name, min_select, max_select, is_active")
        .eq("id", groupId)
        .maybeSingle(),
      supabase
        .from("modifiers")
        .select("id, name, price_delta, kds_station_id, is_active")
        .eq("group_id", groupId)
        .order("sort_order")
        .order("name"),
      supabase
        .from("kds_stations")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order"),
      getMenuCurrency(supabase),
    ]);
  if (!group) notFound();

  return (
    <AdminPage>
      <PageHeader
        title={group.name}
        back={{ href: "/admin/menu/modifiers", label: "Modifier groups" }}
      />
      <Notice
        messages={{ created: "Group created. Add its modifiers below." }}
      />
      <GroupForm
        groupId={group.id}
        initial={{
          name: group.name,
          minSelect: String(group.min_select),
          maxSelect: String(group.max_select),
          isActive: group.is_active,
        }}
      />
      <section className="flex flex-col gap-3 border-t pt-6">
        <div>
          <h2 className="text-lg font-semibold">Modifiers</h2>
          <p className="text-sm text-muted-foreground">
            The price change is added to the item (use a minus for savings).
            Untick “In use” to retire one.
          </p>
        </div>
        <ModifiersEditor
          groupId={group.id}
          currency={currency}
          modifiers={modifiers ?? []}
          stations={stations ?? []}
        />
      </section>
    </AdminPage>
  );
}
