import { Suspense } from "react";
import { OrderTracker } from "@/components/order/order-tracker";

export const metadata = { title: "Your order" };

export default function TrackPage(props: PageProps<"/order/track/[orderId]">) {
  return (
    <Suspense fallback={<p>Loading your order…</p>}>
      <Track {...props} />
    </Suspense>
  );
}

async function Track(props: PageProps<"/order/track/[orderId]">) {
  const { orderId } = await props.params;
  return <OrderTracker orderId={orderId} />;
}
