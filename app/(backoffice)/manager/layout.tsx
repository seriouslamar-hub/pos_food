import { BackOfficeNav, type NavItem } from "@/components/admin/nav";

const MANAGER_NAV: NavItem[] = [
  { href: "/manager", label: "Overview", exact: true },
  { href: "/manager/day", label: "Business day" },
  { href: "/manager/availability", label: "Availability" },
  { href: "/manager/staff", label: "Cashiers" },
  { href: "/manager/audit", label: "Audit log" },
];

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <BackOfficeNav items={MANAGER_NAV} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
