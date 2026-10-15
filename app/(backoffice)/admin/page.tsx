import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Admin" };

export default function Page() {
  return (
    <PlaceholderPage
      title="Admin"
      description="Branches, staff, devices, menu, taxes, reports and settings for every branch."
      phase="Phase 3"
    />
  );
}
