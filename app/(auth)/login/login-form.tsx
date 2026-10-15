"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { signIn, type SignInState } from "@/app/(auth)/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const notices: Record<string, string> = {
  expired: "Your session expired. Sign in again.",
  not_allowed:
    "That account can't open the back office. Sign in as an admin or manager.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const notice =
    notices[searchParams.get("reason") ?? ""] ??
    notices[searchParams.get("error") ?? ""];

  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    signIn,
    {
      error: null,
      email: "",
    },
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : notice ? (
        <Alert aria-live="polite">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          defaultValue={state.email}
          className="h-11"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>
      <Button type="submit" disabled={pending} className="h-11">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
