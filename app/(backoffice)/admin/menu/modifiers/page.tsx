import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice } from "@/components/admin/notice";
import {
  AdminPage,
  EmptyState,
  NewButton,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { groupRule } from "../items/item-preview";
import { GroupList } from "./group-list";

export const metadata: Metadata = { title: "Modifier groups" };

export default function ModifierGroupsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ModifierGroups />
    </Suspense>
  );
}

async function ModifierGroups() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("modifier_groups")
    .select(
      "id, name, min_select, max_select, is_active, modifiers(id), item_modifier_groups(menu_item_id)",
    )
    .order("sort_order")
    .order("name");

  return (
    <AdminPage>
      <PageHeader
        title="Modifier groups"
        description="Sizes, flavours and extras. Attach a group to items on each item's page."
        back={{ href: "/admin/menu", label: "Menu" }}
      >
        <NewButton href="/admin/menu/modifiers/new">New group</NewButton>
      </PageHeader>
      <Notice messages={{ saved: "Group saved." }} />
      {!groups?.length ? (
        <EmptyState>No modifier groups yet.</EmptyState>
      ) : (
        <GroupList
          groups={groups.map((g) => ({
            id: g.id,
            name: g.name,
            rule: groupRule(g.min_select, g.max_select),
            modifierCount: g.modifiers?.length ?? 0,
            itemCount: g.item_modifier_groups?.length ?? 0,
            isActive: g.is_active,
          }))}
        />
      )}
    </AdminPage>
  );
}
