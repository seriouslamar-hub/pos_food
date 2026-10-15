import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Till" };

export default function Page() {
  return (
    <PlaceholderPage
      title="Till"
      description="PIN sign-in and the order screen for cashiers."
      phase="Phase 5"
    />
  );
}
