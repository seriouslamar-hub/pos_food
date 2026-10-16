import { BackOfficeNav, type NavItem } from "@/components/admin/nav";

const ADMIN_NAV: NavItem[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/day", label: "Business day" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/exceptions", label: "Exceptions" },
  { href: "/admin/stock", label: "Stock" },
  { href: "/admin/menu", label: "Menu" },
  { href: "/admin/availability", label: "Availability" },
  { href: "/admin/ingredients", label: "Ingredients" },
  { href: "/admin/recipes", label: "Recipes" },
  { href: "/admin/suppliers", label: "Suppliers" },
  { href: "/admin/branches", label: "Branches" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/devices", label: "Devices" },
  { href: "/admin/taxes", label: "Taxes" },
  { href: "/admin/payment-methods", label: "Payment methods" },
  { href: "/admin/permissions", label: "Permissions" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit log" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <BackOfficeNav items={ADMIN_NAV} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
