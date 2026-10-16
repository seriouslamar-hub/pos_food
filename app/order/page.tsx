import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Choose a branch" };

type Branch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  accepting: boolean;
  prep_minutes: number;
};

export default function OrderPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Branches />
    </Suspense>
  );
}

async function Branches() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_online_branches");
  const branches = (data ?? []) as unknown as Branch[];
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Order for pickup</h1>
      {branches.length === 0 ? (
        <p className="text-muted-foreground">
          Online ordering isn&apos;t available right now.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {branches.map((b) => (
            <li key={b.id}>
              <Link
                href={`/order/${b.id}`}
                className="flex h-full flex-col gap-2 rounded-2xl border p-5 hover:bg-muted"
                data-testid="online-branch"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xl font-semibold">{b.name}</span>
                  {b.accepting ? (
                    <Badge>Open</Badge>
                  ) : (
                    <Badge variant="outline">Not taking orders</Badge>
                  )}
                </span>
                {b.address ? (
                  <span className="text-muted-foreground">{b.address}</span>
                ) : null}
                <span className="text-sm text-muted-foreground">
                  Ready in about {b.prep_minutes} minutes
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
