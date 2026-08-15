"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError, apiPatch, apiPost, apiPut, apiUpload } from "@/lib/api/client";
import {
  DAY_LABELS,
  formatMinuteOfDay,
  parseMinuteOfDay,
  type OperatingHoursDay,
} from "@/lib/vendors/operating-hours";

export type StoreView = {
  status: string;
  storeName: string | null;
  description: string | null;
  phone: string | null;
  storefrontLocation: string | null;
  acceptingOrders: boolean;
  isOpenNow: boolean;
  reviewNote: string | null;
  operatingHours: OperatingHoursDay[];
  studentVendorsAllowed: boolean;
  isStudent: boolean;
};

const APPLICABLE = new Set(["NO_APPLICATION", "INCOMPLETE", "CORRECTION_REQUESTED", "REJECTED"]);

/**
 * Vendor self-service: apply, then manage the store (PRD §17, §19, §23).
 *
 * The component only ever reflects server state. It never decides whether the
 * store is approved, open or eligible — every action is re-validated server-side
 * (Rule 29, Rule 30).
 */
export function StoreManager({ store }: { store: StoreView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "That action could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const banner = (
    <>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {store.reviewNote ? (
        <p className="rounded-xl border border-current/15 p-3 text-sm">
          <span className="font-medium">Note from your campus admin:</span> {store.reviewNote}
        </p>
      ) : null}
    </>
  );

  if (APPLICABLE.has(store.status)) {
    if (store.isStudent && !store.studentVendorsAllowed) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Student stores are closed on this campus</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm opacity-70">
              Your campus admin has not enabled student vendors. Ask them to enable it if you would
              like to sell here.
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        {banner}
        <ApplicationForm busy={busy} run={run} store={store} />
      </div>
    );
  }

  if (store.status === "PENDING_VERIFICATION") {
    return (
      <div className="space-y-4">
        {banner}
        <Card>
          <CardHeader>
            <CardTitle>Application under review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm opacity-70">
              Your campus admin is reviewing <strong>{store.storeName}</strong>. You will be able to
              add products once the store is approved.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (store.status === "SUSPENDED") {
    return (
      <div className="space-y-4">
        {banner}
        <Card>
          <CardHeader>
            <CardTitle>Store suspended</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm opacity-70">
              {store.storeName} cannot trade until your campus admin reinstates it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {banner}

      <Card>
        <CardHeader>
          <CardTitle>{store.storeName}</CardTitle>
          <p className="text-sm opacity-70">
            {store.isOpenNow ? "Open now" : "Closed"} ·{" "}
            {store.acceptingOrders ? "accepting orders" : "not accepting orders"}
          </p>
        </CardHeader>
        <CardContent>
          <Button
            variant={store.acceptingOrders ? "secondary" : "primary"}
            disabled={busy}
            onClick={() =>
              run(
                async () => {
                  await apiPost("/api/vendors/me/accepting-orders", {
                    acceptingOrders: !store.acceptingOrders,
                  });
                },
                store.acceptingOrders ? "Orders paused." : "Your store is taking orders.",
              )
            }
          >
            {store.acceptingOrders ? "Pause orders" : "Start taking orders"}
          </Button>
        </CardContent>
      </Card>

      <StoreDetailsForm busy={busy} run={run} store={store} />
      <OperatingHoursForm busy={busy} run={run} hours={store.operatingHours} />
    </div>
  );
}

type Runner = (action: () => Promise<void>, success: string) => Promise<void>;

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        {...rest}
        className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"
      />
    </label>
  );
}

/** Vendor application, including the two required private uploads (PRD §17). */
function ApplicationForm({
  busy,
  run,
  store,
}: {
  busy: boolean;
  run: Runner;
  store: StoreView;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Apply to sell on Campus Mart</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);

            void run(async () => {
              // Upload evidence first: the application references stored
              // documents by id, so the files must exist before submission.
              const uploadIds: Record<string, string> = {};
              for (const [field, type] of [
                ["storefront", "VENDOR_STOREFRONT"],
                ["identity", "VENDOR_IDENTITY"],
              ] as const) {
                const file = data.get(field);
                if (!(file instanceof File) || file.size === 0) {
                  throw new ApiClientError(
                    "Attach both required documents",
                    "VALIDATION_ERROR",
                    400,
                  );
                }

                const body = new FormData();
                body.set("type", type);
                body.set("file", file);

                const { document } = await apiUpload<{ document: { id: string } }>(
                  "/api/vendors/documents",
                  body,
                );
                uploadIds[field] = document.id;
              }

              await apiPost("/api/vendors/me", {
                storeName: String(data.get("storeName") ?? ""),
                description: String(data.get("description") ?? "") || undefined,
                phone: String(data.get("phone") ?? ""),
                storefrontLocation: String(data.get("storefrontLocation") ?? ""),
                storefrontDocumentId: uploadIds.storefront,
                identityDocumentId: uploadIds.identity,
              });
            }, "Application submitted. Your campus admin will review it.");
          }}
        >
          <TextInput
            label="Store name"
            name="storeName"
            required
            defaultValue={store.storeName ?? ""}
          />
          <TextInput
            label="Phone number"
            name="phone"
            required
            inputMode="tel"
            defaultValue={store.phone ?? ""}
          />
          <TextInput
            label="Where is your storefront?"
            name="storefrontLocation"
            required
            defaultValue={store.storefrontLocation ?? ""}
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">What do you sell? (optional)</span>
            <textarea
              name="description"
              rows={3}
              defaultValue={store.description ?? ""}
              className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"
            />
          </label>

          <TextInput
            label="Photograph of your storefront"
            name="storefront"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            required
          />
          <TextInput
            label="Identity or business document"
            name="identity"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            required
          />

          <Button type="submit" disabled={busy}>
            {busy ? "Submitting…" : "Submit application"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StoreDetailsForm({ busy, run, store }: { busy: boolean; run: Runner; store: StoreView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Store details</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);

            void run(async () => {
              await apiPatch("/api/vendors/me", {
                storeName: String(data.get("storeName") ?? ""),
                phone: String(data.get("phone") ?? ""),
                storefrontLocation: String(data.get("storefrontLocation") ?? ""),
                description: String(data.get("description") ?? "") || null,
              });
            }, "Store details saved.");
          }}
        >
          <TextInput label="Store name" name="storeName" defaultValue={store.storeName ?? ""} />
          <TextInput label="Phone number" name="phone" defaultValue={store.phone ?? ""} />
          <TextInput
            label="Storefront location"
            name="storefrontLocation"
            defaultValue={store.storefrontLocation ?? ""}
          />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Description</span>
            <textarea
              name="description"
              rows={3}
              defaultValue={store.description ?? ""}
              className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"
            />
          </label>
          <Button type="submit" variant="secondary" disabled={busy}>
            Save details
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Weekly trading hours editor (PRD §23). The whole week is submitted at once. */
function OperatingHoursForm({
  busy,
  run,
  hours,
}: {
  busy: boolean;
  run: Runner;
  hours: OperatingHoursDay[];
}) {
  const [days, setDays] = useState<OperatingHoursDay[]>(() =>
    Array.from({ length: 7 }, (_unused, dayOfWeek) => {
      const existing = hours.find((day) => day.dayOfWeek === dayOfWeek);
      return (
        existing ?? { dayOfWeek, isClosed: true, opensAt: null, closesAt: null }
      );
    }),
  );

  function update(dayOfWeek: number, patch: Partial<OperatingHoursDay>) {
    setDays((current) =>
      current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Opening hours</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {days.map((day) => (
            <div key={day.dayOfWeek} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24">{DAY_LABELS[day.dayOfWeek]}</span>

              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={!day.isClosed}
                  onChange={(event) =>
                    update(day.dayOfWeek, {
                      isClosed: !event.target.checked,
                      opensAt: event.target.checked ? (day.opensAt ?? 8 * 60) : null,
                      closesAt: event.target.checked ? (day.closesAt ?? 20 * 60) : null,
                    })
                  }
                />
                <span>Open</span>
              </label>

              <input
                type="time"
                disabled={day.isClosed}
                value={day.opensAt == null ? "" : formatMinuteOfDay(day.opensAt)}
                onChange={(event) =>
                  update(day.dayOfWeek, { opensAt: parseMinuteOfDay(event.target.value) })
                }
                className="rounded-lg border border-current/15 bg-transparent p-2"
              />
              <span className="opacity-60">to</span>
              <input
                type="time"
                disabled={day.isClosed}
                value={day.closesAt == null ? "" : formatMinuteOfDay(day.closesAt)}
                onChange={(event) =>
                  update(day.dayOfWeek, { closesAt: parseMinuteOfDay(event.target.value) })
                }
                className="rounded-lg border border-current/15 bg-transparent p-2"
              />
            </div>
          ))}

          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await apiPut("/api/vendors/me/hours", { days });
              }, "Opening hours saved.")

            }
          >
            Save hours
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
