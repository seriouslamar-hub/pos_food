import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Kitchen display" };

export default function Page() {
  return (
    <PlaceholderPage
      title="Kitchen display"
      description="Live tickets by station with bump and recall."
      phase="Phase 10"
    />
  );
}
