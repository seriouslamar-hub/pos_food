import type { Metadata } from "next";
import { Suspense } from "react";
import {
  BackOfficeHome,
  BackOfficeSkeleton,
} from "@/components/back-office-home";
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
      sections={[
        {
          title: "Device setup",
          description:
            "Turn this browser into a till, kitchen display or pickup screen.",
          phase: "Phase 2",
          href: "/device/setup",
        },
        {
          title: "Cashiers",
          description: "Add and deactivate cashiers, and reset their PINs.",
          phase: "Phase 3",
        },
        {
          title: "Availability",
          description: "Mark items and extras out of stock on every till.",
          phase: "Phase 4",
        },
        {
          title: "Day and shifts",
          description:
            "Open and close the day, reconcile cash and print Z reports.",
          phase: "Phase 7",
        },
        {
          title: "Inventory",
          description: "Deliveries, stock counts, waste and transfers.",
          phase: "Phase 11",
        },
        {
          title: "Reports",
          description: "Branch sales, cashier performance and exceptions.",
          phase: "Phase 12",
        },
      ]}
    />
  );
}
