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
          title: "Branches",
          description: "Names, timezones, currencies, receipts and logos.",
          phase: "Phase 3",
          href: "/admin/branches",
        },
        {
          title: "Staff",
          description: "Admins, managers and cashiers, their logins and PINs.",
          phase: "Phase 3",
          href: "/admin/staff",
        },
        {
          title: "Devices",
          description:
            "Tills, kitchen displays and pickup boards, with setup codes.",
          phase: "Phase 3",
          href: "/admin/devices",
        },
        {
          title: "Taxes and payments",
          description: "Tax rates and the payment methods tills accept.",
          phase: "Phase 3",
          href: "/admin/taxes",
        },
        {
          title: "Permissions and settings",
          description: "What each role may do, and system-wide settings.",
          phase: "Phase 3",
          href: "/admin/permissions",
        },
        {
          title: "Audit log",
          description:
            "Every change and sensitive action, across all branches.",
          phase: "Phase 3",
          href: "/admin/audit",
        },
        {
          title: "Device setup",
          description:
            "Turn this browser into a till, kitchen display or pickup board.",
          phase: "Phase 2",
          href: "/device/setup",
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
