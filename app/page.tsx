import Link from "next/link";

const screens = [
  { href: "/login", name: "Back-office login", who: "Admins and managers" },
  { href: "/admin", name: "Admin", who: "Owner / head office" },
  { href: "/manager", name: "Manager", who: "Branch manager" },
  {
    href: "/device/setup",
    name: "Device setup",
    who: "Register a till, KDS or pickup screen",
  },
  { href: "/till", name: "Till", who: "Cashiers" },
  { href: "/kds", name: "Kitchen display", who: "Kitchen staff" },
  { href: "/pickup", name: "Pickup board", who: "Customers" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Fast-Food POS</h1>
        <p className="text-muted-foreground">Choose a screen.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {screens.map((screen) => (
          <li key={screen.href}>
            <Link
              href={screen.href}
              className="flex min-h-12 flex-col gap-1 rounded-xl border p-4 transition-colors hover:bg-muted"
            >
              <span className="font-medium">{screen.name}</span>
              <span className="text-sm text-muted-foreground">
                {screen.who}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
