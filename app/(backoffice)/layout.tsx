import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireStaff } from "@/lib/auth";

export default function BackOfficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          Fast-Food POS
        </Link>
        <Suspense fallback={<div className="h-8 w-40" />}>
          <SignedInAs />
        </Suspense>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

async function SignedInAs() {
  const staff = await requireStaff(["admin", "manager"]);
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm sm:inline">{staff.fullName}</span>
      <Badge variant="secondary" className="capitalize">
        {staff.role}
      </Badge>
      <form action={signOut}>
        <Button type="submit" variant="outline" size="sm">
          Sign out
        </Button>
      </form>
    </div>
  );
}
