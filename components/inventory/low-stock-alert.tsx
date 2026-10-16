import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isLowStock } from "@/lib/inventory";
import { createClient } from "@/lib/supabase/server";

/** Names the branch's ingredients that are below their reorder level. */
export async function LowStockAlert({
  branchId,
  href,
}: {
  branchId: string;
  href: string;
}) {
  const supabase = await createClient();
  const [{ data: ingredients }, { data: stock }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, reorder_level")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("branch_stock")
      .select("ingredient_id, quantity_on_hand")
      .eq("branch_id", branchId),
  ]);
  const onHand = new Map(
    (stock ?? []).map((s) => [s.ingredient_id, Number(s.quantity_on_hand)]),
  );
  const low = (ingredients ?? []).filter((i) =>
    isLowStock(onHand.get(i.id) ?? 0, Number(i.reorder_level)),
  );
  if (low.length === 0) return null;
  return (
    <Alert variant="destructive" data-testid="low-stock-alert">
      <AlertDescription className="text-base">
        Low stock: {low.map((i) => i.name).join(", ")}.{" "}
        <Link href={href} className="underline">
          Order more
        </Link>
      </AlertDescription>
    </Alert>
  );
}
