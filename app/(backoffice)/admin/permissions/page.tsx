import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PermissionGrid } from "./permission-grid";

export const metadata: Metadata = { title: "Permissions" };

export default function PermissionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Permissions />
    </Suspense>
  );
}

async function Permissions() {
  await requireStaff(["admin"]);
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("role_permissions")
    .select("role, permission");
  const granted = {
    manager: (rows ?? [])
      .filter((r) => r.role === "manager")
      .map((r) => r.permission),
    cashier: (rows ?? [])
      .filter((r) => r.role === "cashier")
      .map((r) => r.permission),
  };

  return (
    <AdminPage>
      <PageHeader
        title="Permissions"
        description="What each role can do. When a cashier lacks a permission, the till asks for a manager's PIN instead. Changes reach the till at the next PIN sign-in."
      />
      <PermissionGrid granted={granted} />
    </AdminPage>
  );
}
