import type { Metadata } from "next";
import { Suspense } from "react";
import {
  BackOfficeHome,
  BackOfficeSkeleton,
} from "@/components/back-office-home";
import { LowStockAlert } from "@/components/inventory/low-stock-alert";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Manager" };

export default function ManagerPage() {
  return (
    <Suspense fallback={<BackOfficeSkeleton />}>
      <ManagerHome />
    </Suspense>
  );
}

async function ManagerHome() {
  const staff = await requireStaff(["admin", "manager"]);
  return (
    <BackOfficeHome
      heading={`Welcome, ${staff.fullName}`}
      intro="Your branch: the business day, shifts, cash, stock and reports."
      alert={
        staff.branchId ? (
          <LowStockAlert
            branchId={staff.branchId}
            href="/manager/inventory/orders/new"
          />
        ) : null
      }
      sections={[
        {
          title: "Cashiers",
          description: "Add and deactivate cashiers, and reset their PINs.",
          phase: "Phase 3",
          href: "/manager/staff",
        },
        {
          title: "Audit log",
          description: "Changes and sensitive actions in your branch.",
          phase: "Phase 3",
          href: "/manager/audit",
        },
        {
          title: "Device setup",
          description:
            "Turn this browser into a till, kitchen display or pickup board.",
          phase: "Phase 2",
          href: "/device/setup",
        },
        {
          title: "Availability",
          description: "Mark items and extras out of stock on every till.",
          phase: "Phase 4",
          href: "/manager/availability",
        },
        {
          title: "Day and shifts",
          description:
            "Open and close the day, reconcile cash and print Z reports.",
          phase: "Phase 7",
          href: "/manager/day",
        },
        {
          title: "Orders and exceptions",
          description:
            "Find an order; voids, refunds and discounts by cashier.",
          phase: "Phase 8",
          href: "/manager/orders",
        },
        {
          title: "Stock",
          description:
            "Deliveries, waste, counts, transfers and low-stock alerts.",
          phase: "Phase 11",
          href: "/manager/inventory",
        },
        {
          title: "Reports",
          description: "Branch sales, cashier performance and exceptions.",
          phase: "Phase 12",
          href: "/manager/reports",
        },
      ]}
    />
  );
}
