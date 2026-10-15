import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSignedInUser } from "@/lib/auth";
import { deviceHome } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";
import { DeviceSetupForm, type SetupDevice } from "./device-setup-form";

export const metadata: Metadata = { title: "Device setup" };

export default function DeviceSetupPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Device setup</CardTitle>
          <CardDescription>
            Turn this browser into a till, kitchen display or pickup board.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={
              <div className="h-48 animate-pulse rounded-xl bg-muted" />
            }
          >
            <DeviceSetup />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

async function DeviceSetup() {
  const user = await getSignedInUser();

  if (user?.device) {
    return (
      <div className="flex flex-col gap-4">
        <p>
          This browser is set up as <strong>{user.device.name}</strong> (
          {user.device.code}).
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={deviceHome(user.device.type)}
            className={buttonVariants({ size: "touch" })}
          >
            Open {user.device.name}
          </Link>
          <Link
            href="/login?next=/device/setup"
            className={buttonVariants({ size: "touch", variant: "outline" })}
          >
            Set up a different device
          </Link>
        </div>
      </div>
    );
  }

  const staff = user?.staff;
  if (!staff) {
    return (
      <div className="flex flex-col gap-4">
        <p>An admin or manager needs to sign in to set up this device.</p>
        <Link
          href="/login?next=/device/setup"
          className={buttonVariants({ size: "touch", className: "self-start" })}
        >
          Sign in
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: branches }, { data: devices }] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("devices")
      .select("id, branch_id, name, type, code, last_seen_at")
      .eq("is_active", true)
      .order("code"),
  ]);

  const setupDevices: SetupDevice[] = (devices ?? []).map((d) => ({
    id: d.id,
    branchId: d.branch_id,
    name: d.name,
    type: d.type,
    code: d.code,
    lastSeenAt: d.last_seen_at,
  }));

  return (
    <DeviceSetupForm
      branches={branches ?? []}
      devices={setupDevices}
      defaultBranchId={staff.branchId}
    />
  );
}
