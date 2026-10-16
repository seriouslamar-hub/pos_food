import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Order online", template: "%s · Order online" },
};

export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6">
      {children}
    </div>
  );
}
