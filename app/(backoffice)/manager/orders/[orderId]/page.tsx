import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPage, PageHeader, PageSkeleton } from "@/components/admin/page";
import { OrderDetailView } from "@/components/orders/views";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Order" };

export default function ManagerOrderPage({
  params,
}: PageProps<"/manager/orders/[orderId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Order params={params} />
    </Suspense>
  );
}

async function Order({ params }: { params: Promise<{ orderId: string }> }) {
  await requireStaff(["admin", "manager"]);
  const { orderId } = await params;
  return (
    <AdminPage>
      <PageHeader
        title="Order"
        back={{ href: "/manager/orders", label: "Orders" }}
      />
      <OrderDetailView orderId={orderId} />
    </AdminPage>
  );
}
