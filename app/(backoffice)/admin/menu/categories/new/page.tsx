import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { CategoryForm } from "../category-form";

export const metadata: Metadata = { title: "New category" };

export default function NewCategoryPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewCategory />
    </Suspense>
  );
}

async function NewCategory() {
  await requireStaff(["admin"]);
  return (
    <AdminPage>
      <PageHeader
        title="New category"
        back={{ href: "/admin/menu", label: "Menu" }}
      />
      <CategoryForm initial={{ name: "", colour: "", isActive: true }} />
    </AdminPage>
  );
}
