import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>
            Back office for admins and managers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Suspense fallback={<div className="h-56" />}>
            <LoginForm />
          </Suspense>
          <p className="text-sm text-muted-foreground">
            Setting up a till or kitchen screen?{" "}
            <Link href="/device/setup" className="underline underline-offset-4">
              Device setup
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
