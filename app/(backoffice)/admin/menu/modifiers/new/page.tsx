import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { GroupForm } from "../group-form";

export const metadata: Metadata = { title: "New modifier group" };

export default function NewGroupPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewGroup />
    </Suspense>
  );
}

async function NewGroup() {
  await requireStaff(["admin"]);
  return (
    <AdminPage>
      <PageHeader
        title="New modifier group"
        back={{ href: "/admin/menu/modifiers", label: "Modifier groups" }}
      />
      <GroupForm
        initial={{ name: "", minSelect: "0", maxSelect: "1", isActive: true }}
      />
    </AdminPage>
  );
}
