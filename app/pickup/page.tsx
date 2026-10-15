import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Pickup board" };

export default function Page() {
  return (
    <PlaceholderPage
      title="Pickup board"
      description="Preparing and ready order numbers for customers."
      phase="Phase 10"
    />
  );
}
