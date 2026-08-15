"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { HandoverVerify } from "@/components/delivery/handover-verify";
import { ApiClientError, apiPatch, apiPost } from "@/lib/api/client";

import { formatKobo } from "@/lib/money";

/**
 * The agent's workspace: standing, duty switch, the pool, and their own work.
 *
 * The lists are rendered from data the page loaded on the server and refreshed
 * with `router.refresh()` after every action, so the pool an agent sees is
 * always one the server decided they may see. The component keeps no rules of
 * its own — it does not filter the pool, judge a deadline, or infer which step
 * is legal next; it renders what the server sent and reports what it refused.
 */

type AgentProfile = {
  id: string;
  status: string;
  isOnDuty: boolean;
  cancellationCount: number;
  isWarned: boolean;
  isUnderReview: boolean;
  reviewNote: string | null;
};

export type AgentDelivery = {
  id: string;
  status: string;
  orderReference: string;
  pickupName: string;
  pickupLocation: string;
  destinationName: string;
  destinationNote: string | null;
  studentPhone: string | null;
  orderDeliveryFeeKobo: number;
  pickupDeadline: Date | string | null;
  waitDeadline: Date | string | null;
  offerCount: number;
};

const NEXT_STEP: Record<
  string,
  { action: "PICKED_UP" | "IN_TRANSIT" | "ARRIVED"; label: string }
> = {
  ACCEPTED: { action: "PICKED_UP", label: "I have collected the package" },
  PICKED_UP: { action: "IN_TRANSIT", label: "On my way" },
  IN_TRANSIT: { action: "ARRIVED", label: "I have arrived" },
};

/** Display only; the server is the one that decides whether time has run out. */
function countdown(deadline: Date | string | null): string | null {
  if (!deadline) return null;
  const minutes = Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 60_000));
  return minutes === 0 ? "time is up" : `${minutes} min left`;
}

export function AgentConsole({
  agent,
  mine,
  pool,
}: {
  agent: AgentProfile | null;
  mine: AgentDelivery[];
  pool: AgentDelivery[];
}) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!agent || agent.status === "REJECTED" || agent.status === "CORRECTION_REQUESTED") {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Deliver for your campus</h1>
        <p className="text-sm text-muted-foreground">
          Approved students carry packages from stores to delivery points and keep the delivery fee.
          Your campus admin reviews every application.
        </p>
        {agent?.reviewNote ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{agent.reviewNote}</p>
        ) : null}
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await apiPost("/api/agents/me", { phone });
            });
          }}
        >
          <input
            aria-label="Phone number"
            className="w-full rounded-md border px-3 py-2 text-sm sm:max-w-xs"
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Phone number"
            required
            value={phone}
          />
          <button
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            Apply to deliver
          </button>
        </form>
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
      </section>
    );
  }

  if (agent.status !== "APPROVED") {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">Delivery agent</h1>
        <p className="text-sm text-muted-foreground">
          {agent.status === "PENDING_VERIFICATION"
            ? "Your application is with your campus admin. You can take deliveries once it is approved."
            : "Your agent account is suspended. Contact your campus admin."}
        </p>
        {agent.reviewNote ? <p className="text-sm">{agent.reviewNote}</p> : null}
      </section>
    );
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Deliveries</h1>
          <p className="text-sm text-muted-foreground">
            {agent.isOnDuty ? "On duty — you can see the pool." : "Off duty — the pool is hidden."}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy}
            onClick={() => router.refresh()}
            type="button"
          >
            Refresh
          </button>
          <button
            className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await apiPatch("/api/agents/me", { isOnDuty: !agent.isOnDuty });
              })
            }
            type="button"
          >
            {agent.isOnDuty ? "Go off duty" : "Go on duty"}
          </button>
        </div>
      </section>

      {agent.isUnderReview ? (
        <p className="rounded-md bg-destructive/10 p-3 text-sm">
          Your cancellations are under review by your campus admin.
        </p>
      ) : agent.isWarned ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          You have cancelled {agent.cancellationCount} deliveries. Repeated cancellations can cost
          you your agent account.
        </p>
      ) : null}

      {message ? <p className="text-sm text-destructive">{message}</p> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Your deliveries</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing assigned to you yet.</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((delivery) => {
              const step = NEXT_STEP[delivery.status];
              const pickupLeft = countdown(delivery.pickupDeadline);
              const waitLeft = countdown(delivery.waitDeadline);

              return (
                <li className="rounded-lg border p-4" key={delivery.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {delivery.pickupName} → {delivery.destinationName}
                    </p>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {delivery.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {delivery.orderReference} · pick up at {delivery.pickupLocation} ·{" "}
                    {formatKobo(delivery.orderDeliveryFeeKobo)}
                  </p>
                  {delivery.studentPhone ? (
                    <p className="text-sm">
                      Student {delivery.studentPhone}
                      {delivery.destinationNote ? ` · ${delivery.destinationNote}` : ""}
                    </p>
                  ) : null}
                  {delivery.status === "ACCEPTED" && pickupLeft ? (
                    <p className="mt-1 text-sm font-medium">Collect the package: {pickupLeft}</p>
                  ) : null}
                  {delivery.status === "ARRIVED" && waitLeft ? (
                    <p className="mt-1 text-sm font-medium">Student has {waitLeft}</p>
                  ) : null}

                  {/*
                    The hand-over itself (PRD §45). The box appears from arrival
                    onwards: the agent asks the student to generate the code, and
                    typing it is what completes the delivery.
                  */}
                  {delivery.status === "ARRIVED" || delivery.status === "AWAITING_OTP" ? (
                    <div className="mt-3">
                      <HandoverVerify deliveryId={delivery.id} />
                    </div>
                  ) : null}

                  {delivery.status === "PAYMENT_PENDING" ? (
                    <p className="mt-2 text-sm">
                      Handed over. The student is paying for their goods — you are free to take the
                      next delivery.
                    </p>
                  ) : null}


                  <div className="mt-3 flex flex-wrap gap-2">
                    {step ? (
                      <button
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await apiPatch(`/api/deliveries/${delivery.id}`, {
                              action: step.action,
                            });
                          })
                        }
                        type="button"
                      >
                        {step.label}
                      </button>
                    ) : null}

                    {delivery.status === "ACCEPTED" ? (
                      <button
                        className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          const reason = window.prompt("Why are you giving this delivery up?");
                          if (!reason) return;
                          void run(async () => {
                            const result = await apiPost<{ escalation: string }>(
                              `/api/deliveries/${delivery.id}/cancel`,
                              { reason },
                            );
                            if (result.escalation !== "NONE") {
                              setMessage(
                                result.escalation === "REVIEW"
                                  ? "Your cancellations are now under admin review."
                                  : "That is a lot of cancellations — you have been warned.",
                              );
                            }
                          });
                        }}
                        type="button"
                      >
                        Give up
                      </button>
                    ) : null}

                    {delivery.status === "ARRIVED" ? (
                      <button
                        className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          const note = window.prompt("Anything to add?") ?? undefined;
                          void run(async () => {
                            await apiPost(`/api/deliveries/${delivery.id}/unavailable`, { note });
                          });
                        }}
                        type="button"
                      >
                        Student did not show
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Available now</h2>
        {!agent.isOnDuty ? (
          <p className="text-sm text-muted-foreground">Go on duty to see available deliveries.</p>
        ) : pool.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deliveries waiting. If you are carrying a package, only jobs to the same destination
            are offered.
          </p>
        ) : (
          <ul className="space-y-3">
            {pool.map((delivery) => (
              <li className="rounded-lg border p-4" key={delivery.id}>
                <p className="font-medium">
                  {delivery.pickupName} → {delivery.destinationName}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick up at {delivery.pickupLocation} · {formatKobo(delivery.orderDeliveryFeeKobo)}
                  {delivery.offerCount > 0 ? " · re-offered" : ""}
                </p>
                <button
                  className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await apiPost(`/api/deliveries/${delivery.id}/accept`);
                    })
                  }
                  type="button"
                >
                  Accept
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
