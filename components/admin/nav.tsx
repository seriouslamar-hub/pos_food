"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; exact?: boolean };

/**
 * Back-office sidebar (a scrolling row of links on small screens). The active
 * link needs the pathname, which isn't known while prerendering pages with
 * ids in the URL, so it sits behind Suspense with an unhighlighted fallback.
 */
export function BackOfficeNav({ items }: { items: NavItem[] }) {
  return (
    <nav
      aria-label="Back office"
      className="border-b md:w-56 md:shrink-0 md:border-r md:border-b-0"
    >
      <Suspense fallback={<NavLinks items={items} pathname={null} />}>
        <ActiveNavLinks items={items} />
      </Suspense>
    </nav>
  );
}

function ActiveNavLinks({ items }: { items: NavItem[] }) {
  return <NavLinks items={items} pathname={usePathname()} />;
}

function NavLinks({
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string | null;
}) {
  return (
    <ul className="flex gap-1 overflow-x-auto p-2 md:sticky md:top-0 md:flex-col md:p-3">
      {items.map((item) => {
        const active =
          pathname !== null &&
          (item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`));
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center rounded-md px-3 text-sm whitespace-nowrap transition-colors hover:bg-muted",
                active && "bg-muted font-medium",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
