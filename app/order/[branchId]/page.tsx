import Link from "next/link";
import { Suspense } from "react";
import { OnlineOrderApp } from "@/components/order/online-order-app";
import { parseMenu } from "@/lib/menu";
import { onlineProvider } from "@/lib/payments/online";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Menu" };

export default function BranchMenuPage(props: PageProps<"/order/[branchId]">) {
  return (
    <Suspense fallback={<p>Loading the menu…</p>}>
      <BranchMenu {...props} />
    </Suspense>
  );
}

async function BranchMenu(props: PageProps<"/order/[branchId]">) {
  const { branchId } = await props.params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_menu", {
    p_branch_id: branchId,
  });
  if (error || !data)
    return (
      <main className="flex flex-col gap-4">
        <p>This branch doesn&apos;t take online orders.</p>
        <Link href="/order" className="underline">
          Choose another branch
        </Link>
      </main>
    );
  const doc = data as unknown as {
    online: {
      paused: boolean;
      day_open: boolean;
      prep_minutes: number;
      pay_at_counter: boolean;
    };
  };
  const menu = parseMenu({
    ...(data as object),
    payment_methods: [],
    stations: [],
  });
  return (
    <OnlineOrderApp
      menu={menu}
      online={doc.online}
      payOnline={onlineProvider() !== null}
    />
  );
}
