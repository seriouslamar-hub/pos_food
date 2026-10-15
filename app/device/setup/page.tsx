import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/placeholder-page";

export const metadata: Metadata = { title: "Device setup" };

export default function Page() {
  return (
    <PlaceholderPage
      title="Device setup"
      description="Register this screen as a till, kitchen display or pickup board."
      phase="Phase 2"
    />
  );
}
