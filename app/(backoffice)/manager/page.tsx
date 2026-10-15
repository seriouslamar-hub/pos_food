import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Manager" };

export default function Page() {
  return (
    <PlaceholderPage
      title="Manager"
      description="Business day, shifts, cash-up, availability, inventory and reports for one branch."
      phase="Phase 3"
    />
  );
}
