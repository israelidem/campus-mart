import Link from "next/link";

import { requireActor } from "@/lib/auth/session";
import { formatKobo } from "@/lib/money";
import { verifyPaymentForActor } from "@/lib/payments/payment-service";
import { paymentReferenceSchema } from "@/validations/payment";

/**
 * Where Paystack returns the student (PRD §33).
 *
 * The page does not believe the redirect. It verifies the reference with
 * Paystack server-side and applies the outcome through the same guarded path the
 * webhook uses, so whichever arrives first settles the order and the other is a
 * no-op. If the provider is still processing, the student is told to wait rather
 * than shown a false success.
 */
export default async function PaymentCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const actor = await requireActor();
  const { reference } = await searchParams;

  const parsed = paymentReferenceSchema.safeParse(reference ?? "");
  if (!parsed.success) {
    return (
      <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <h1 className="text-2xl font-semibold">Payment reference missing</h1>
        <p className="text-sm opacity-80">
          We could not tell which payment this was. Open the order and check its status.
        </p>
        <Link className="text-sm underline" href="/orders">
          Back to my orders
        </Link>
      </main>
    );
  }

  const payment = await verifyPaymentForActor(actor, parsed.data);

  const heading =
    payment.status === "SUCCESS"
      ? "Payment received"
      : payment.status === "PENDING"
        ? "Payment still processing"
        : payment.status === "REFUNDED"
          ? "Payment refunded"
          : "Payment not completed";

  const explanation =
    payment.status === "SUCCESS"
      ? payment.purpose === "DELIVERY_FEE"
        ? "Your delivery fee is settled. Vendors can now hand your packages to an agent."
        : "Your goods are paid for. This delivery is complete."
      : payment.status === "PENDING"
        ? "Paystack has not confirmed this payment yet. Refresh this page in a moment — nothing is lost."
        : payment.status === "REFUNDED"
          ? "This payment arrived after the order could no longer be fulfilled, so it was sent back."
          : (payment.failureReason ?? "The payment did not go through. You can try again from the order.");

  return (
    <main className="mx-auto max-w-xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="text-sm opacity-80">{explanation}</p>

      <dl className="grid grid-cols-2 gap-2 rounded-2xl border border-current/15 p-4 text-sm">
        <dt className="opacity-70">Reference</dt>
        <dd className="font-mono">{payment.reference}</dd>
        <dt className="opacity-70">Amount</dt>
        <dd>{formatKobo(payment.amountKobo)}</dd>
        <dt className="opacity-70">Status</dt>
        <dd>{payment.status}</dd>
      </dl>

      <Link className="text-sm underline" href="/orders">
        Back to my orders
      </Link>
    </main>
  );
}
