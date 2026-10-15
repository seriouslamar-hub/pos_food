import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice } from "@/components/admin/notice";
import {
  AdminPage,
  EmptyState,
  NewButton,
  PageHeader,
  PageSkeleton,
} from "@/components/admin/page";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireStaff } from "@/lib/auth";
import { DEVICE_TYPE_LABELS, deviceStatus, requestTime } from "@/lib/devices";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Devices" };

export default function DevicesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Devices />
    </Suspense>
  );
}

async function Devices() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const [{ data: devices }, { data: branches }] = await Promise.all([
    supabase
      .from("devices")
      .select(
        "id, branch_id, name, type, code, station, is_active, last_seen_at, auth_user_id",
      )
      .order("code"),
    supabase.from("branches").select("id, name").order("name"),
  ]);
  const now = requestTime();

  return (
    <AdminPage>
      <PageHeader
        title="Devices"
        description="Tills, kitchen displays and pickup boards. Online means the device checked in within the last 2 minutes."
      >
        <NewButton href="/admin/devices/new">New device</NewButton>
      </PageHeader>
      <Notice messages={{ saved: "Device saved." }} />

      {!branches?.length ? (
        <EmptyState>Create a branch first, then add its devices.</EmptyState>
      ) : (
        branches.map((branch) => {
          const list = (devices ?? []).filter((d) => d.branch_id === branch.id);
          return (
            <section key={branch.id} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{branch.name}</h2>
              {!list.length ? (
                <p className="text-sm text-muted-foreground">No devices yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Connection</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((d) => {
                      const status = deviceStatus(d.last_seen_at, now);
                      return (
                        <TableRow key={d.id}>
                          <TableCell>
                            <Link
                              href={`/admin/devices/${d.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {d.name}
                            </Link>
                          </TableCell>
                          <TableCell className="font-mono">{d.code}</TableCell>
                          <TableCell>
                            {DEVICE_TYPE_LABELS[d.type]}
                            {d.station ? ` · ${d.station}` : ""}
                          </TableCell>
                          <TableCell>
                            {!d.auth_user_id ? (
                              <span className="text-muted-foreground">
                                Not set up
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <span
                                  aria-hidden
                                  className={`size-2 rounded-full ${status.online ? "bg-green-600" : "bg-muted-foreground/40"}`}
                                />
                                {status.label}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={d.is_active ? "secondary" : "outline"}
                            >
                              {d.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </section>
          );
        })
      )}
    </AdminPage>
  );
}
