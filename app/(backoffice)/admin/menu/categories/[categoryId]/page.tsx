import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CategoryForm } from "../category-form";

export const metadata: Metadata = { title: "Edit category" };

export default function EditCategoryPage({
  params,
}: PageProps<"/admin/menu/categories/[categoryId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EditCategory params={params} />
    </Suspense>
  );
}

async function EditCategory({
  params,
}: {
  params: Promise<{ categoryId: string }>;
}) {
  await requireStaff(["admin"]);
  const { categoryId } = await params;
  const supabase = await createClient();
  const { data: category } = await supabase
    .from("categories")
    .select("id, name, colour, is_active")
    .eq("id", categoryId)
    .maybeSingle();
  if (!category) notFound();

  return (
    <AdminPage>
      <PageHeader
        title={category.name}
        back={{ href: `/admin/menu?category=${category.id}`, label: "Menu" }}
      />
      <CategoryForm
        categoryId={category.id}
        initial={{
          name: category.name,
          colour: category.colour ?? "",
          isActive: category.is_active,
        }}
      />
    </AdminPage>
  );
}
