import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImageUploader } from "@/components/admin/image-uploader";
import { Notice } from "@/components/admin/notice";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { setMenuItemImage } from "@/lib/actions/menu";
import { requireStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { formatAmount, toMoneyInput } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { BranchPrices } from "../branch-prices";
import { ComboBuilder } from "../combo-builder";
import { ItemForm } from "../item-form";
import { ItemModifierGroups } from "../item-modifier-groups";
import { groupRule, ItemPreview } from "../item-preview";

export const metadata: Metadata = { title: "Edit menu item" };

export default function EditItemPage({
  params,
}: PageProps<"/admin/menu/items/[itemId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditItem params={params} />
    </Suspense>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

async function EditItem({ params }: { params: Promise<{ itemId: string }> }) {
  await requireStaff(["admin"]);
  const { itemId } = await params;
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("menu_items")
    .select(
      "id, category_id, type, name, short_name, description, image_url, base_price, tax_category, kds_station_id, is_active",
    )
    .eq("id", itemId)
    .maybeSingle();
  if (!item) notFound();

  const [
    { data: categories },
    { data: stations },
    { data: taxes },
    { data: groups },
    { data: links },
    { data: slots },
    { data: plainItems },
    { data: branches },
    { data: branchRows },
    currency,
  ] = await Promise.all([
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
    supabase
      .from("modifier_groups")
      .select(
        "id, name, min_select, max_select, is_active, modifiers(name, price_delta, is_active, sort_order)",
      )
      .order("sort_order")
      .order("name"),
    supabase
      .from("item_modifier_groups")
      .select("modifier_group_id, sort_order")
      .eq("menu_item_id", itemId)
      .order("sort_order"),
    item.type === "combo"
      ? supabase
          .from("combo_slots")
          .select(
            "id, name, required, sort_order, combo_slot_options(menu_item_id, upcharge, is_default, sort_order)",
          )
          .eq("combo_item_id", itemId)
          .order("sort_order")
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("menu_items")
      .select("id, name, is_active")
      .eq("type", "item")
      .order("name"),
    supabase.from("branches").select("id, name, currency_code").order("name"),
    supabase
      .from("branch_menu_items")
      .select("branch_id, price_override, is_available")
      .eq("menu_item_id", itemId),
    getMenuCurrency(supabase),
  ]);

  const linkedIds = (links ?? []).map((l) => l.modifier_group_id);
  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
  const itemName = new Map((plainItems ?? []).map((i) => [i.id, i.name]));
  const comboSlots = (slots ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    required: s.required,
    options: [...(s.combo_slot_options ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({
        menuItemId: o.menu_item_id,
        upcharge: o.upcharge,
        isDefault: o.is_default,
      })),
  }));
  const overrideByBranch = new Map(
    (branchRows ?? []).map((r) => [r.branch_id, r]),
  );

  return (
    <AdminPage className="max-w-5xl">
      <PageHeader
        title={item.name}
        description={`${item.type === "combo" ? "Combo" : "Item"} · ${formatAmount(item.base_price, currency)}`}
        back={{
          href: `/admin/menu?category=${item.category_id}`,
          label: "Menu",
        }}
      />
      <Notice
        messages={{
          created: "Created. Add a photo, modifiers or combo slots below.",
        }}
      />

      <ItemForm
        itemId={item.id}
        currency={currency}
        categories={categories ?? []}
        stations={stations ?? []}
        taxCategories={[...new Set((taxes ?? []).map((t) => t.tax_category))]}
        initial={{
          categoryId: item.category_id,
          type: item.type,
          name: item.name,
          shortName: item.short_name ?? "",
          description: item.description ?? "",
          price: toMoneyInput(item.base_price, currency),
          taxCategory: item.tax_category,
          kdsStationId: item.kds_station_id ?? "",
          isActive: item.is_active,
        }}
      />

      <Section
        title="Photo"
        description="Shown on the till tile and, later, the kiosk."
      >
        <ImageUploader
          bucket="menu-images"
          folder={`items/${item.id}`}
          imageUrl={item.image_url}
          alt={item.name}
          hint="PNG, JPEG or WebP, up to 2 MB. Square photos look best."
          maxBytes={2 * 1024 * 1024}
          onSave={setMenuItemImage.bind(null, item.id)}
        />
      </Section>

      {item.type === "combo" ? (
        <Section
          title="Combo slots"
          description="Each slot is a choice the cashier makes, e.g. the side and the drink. Upsizing uses the side's or drink's own size options."
        >
          <ComboBuilder
            comboId={item.id}
            currency={currency}
            slots={comboSlots}
            items={(plainItems ?? []).map((i) => ({
              id: i.id,
              name: i.name,
              isActive: i.is_active,
            }))}
          />
        </Section>
      ) : null}

      <Section
        title="Modifier groups"
        description="Choices like size, flavour or extras."
      >
        <ItemModifierGroups
          itemId={item.id}
          initialSelected={linkedIds}
          groups={(groups ?? []).map((g) => ({
            id: g.id,
            name: g.name,
            rule: groupRule(g.min_select, g.max_select),
            isActive: g.is_active,
            modifiers: [...(g.modifiers ?? [])]
              .filter((m) => m.is_active)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((m) => m.name)
              .join(", "),
          }))}
        />
      </Section>

      <Section
        title="Branch prices"
        description="Leave empty to charge the menu price."
      >
        <BranchPrices
          itemId={item.id}
          basePrice={item.base_price}
          rows={(branches ?? []).map((b) => ({
            branchId: b.id,
            branchName: b.name,
            currency: b.currency_code,
            priceOverride: overrideByBranch.get(b.id)?.price_override ?? null,
            isAvailable: overrideByBranch.get(b.id)?.is_available ?? true,
          }))}
        />
      </Section>

      <Section title="On the till">
        <ItemPreview
          currency={currency}
          item={{
            id: item.id,
            name: item.name,
            price: item.base_price,
            image_url: item.image_url,
            type: item.type,
          }}
          slots={comboSlots.map((s) => ({
            name: s.name,
            required: s.required,
            options: s.options.map((o) => ({
              name: itemName.get(o.menuItemId) ?? "",
              upcharge: o.upcharge,
              isDefault: o.isDefault,
            })),
          }))}
          groups={linkedIds
            .map((id) => groupById.get(id))
            .filter((g) => g && g.is_active)
            .map((g) => ({
              name: g!.name,
              rule: groupRule(g!.min_select, g!.max_select),
              modifiers: [...(g!.modifiers ?? [])]
                .filter((m) => m.is_active)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((m) => ({ name: m.name, priceDelta: m.price_delta })),
            }))}
        />
      </Section>
    </AdminPage>
  );
}
