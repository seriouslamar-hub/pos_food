import type { Metadata } from "next";
import { Suspense } from "react";
import {
  BackOfficeHome,
  BackOfficeSkeleton,
} from "@/components/back-office-home";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <Suspense fallback={<BackOfficeSkeleton />}>
      <AdminHome />
    </Suspense>
  );
}

async function AdminHome() {
  const staff = await requireStaff(["admin"]);
  return (
    <BackOfficeHome
      heading={`Welcome, ${staff.fullName}`}
      intro="Head office: every branch, the menu, staff and system settings."
      sections={[
        {
          title: "Device setup",
          description:
            "Turn this browser into a till, kitchen display or pickup screen.",
          phase: "Phase 2",
          href: "/device/setup",
        },
        {
          title: "Manager view",
          description: "See the back office as a branch manager does.",
          phase: "Phase 2",
          href: "/manager",
        },
        {
          title: "Branches, staff and devices",
          description: "Create branches, managers, cashiers and devices.",
          phase: "Phase 3",
        },
        {
          title: "Taxes, payments and permissions",
          description:
            "Tax rates, payment methods and the role permission grid.",
          phase: "Phase 3",
        },
        {
          title: "Menu",
          description:
            "Categories, items, modifiers, combos and branch prices.",
          phase: "Phase 4",
        },
        {
          title: "Reports",
          description: "Sales, tax and performance across every branch.",
          phase: "Phase 12",
        },
      ]}
    />
  );
}
