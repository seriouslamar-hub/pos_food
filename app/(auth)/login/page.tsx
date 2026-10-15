import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <PlaceholderPage
      title="Sign in"
      description="Email and password sign-in for admins and managers."
      phase="Phase 2"
    />
  );
}
