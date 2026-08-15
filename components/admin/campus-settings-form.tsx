"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ApiClientError, apiPatch, fieldErrors } from "@/lib/api/client";
import { koboToNaira, nairaToKobo } from "@/lib/money";

export type CampusSettingsValues = {
  allowStudentVendors: boolean;
  requireRegistryMatch: boolean;
  deliveryBaseFeeKobo: number;
  deliveryPerKmKobo: number;
  deliveryMinimumFeeKobo: number;
  deliveryMaximumFeeKobo: number;
  commissionBps: number;
  pickupWindowMinutes: number;
  studentWaitMinutes: number;
  goodsPaymentWindowMinutes: number;
  announcement: string | null;
};

/**
 * Campus settings form (PRD §18, §29, §35, §47).
 *
 * Fees are entered in naira for legibility and converted to integer kobo before
 * they are sent; the server validates them as kobo regardless (PRD §64).
 * Commission is entered as a percentage and sent as basis points.
 */
export function CampusSettingsForm({ initial }: { initial: CampusSettingsValues }) {
  const router = useRouter();

  const [values, setValues] = useState({
    allowStudentVendors: initial.allowStudentVendors,
    requireRegistryMatch: initial.requireRegistryMatch,
    baseFee: String(koboToNaira(initial.deliveryBaseFeeKobo)),
    perKm: String(koboToNaira(initial.deliveryPerKmKobo)),
    minimumFee: String(koboToNaira(initial.deliveryMinimumFeeKobo)),
    maximumFee: String(koboToNaira(initial.deliveryMaximumFeeKobo)),
    commissionPercent: String(initial.commissionBps / 100),
    pickupWindowMinutes: String(initial.pickupWindowMinutes),
    studentWaitMinutes: String(initial.studentWaitMinutes),
    goodsPaymentWindowMinutes: String(initial.goodsPaymentWindowMinutes),
    announcement: initial.announcement ?? "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const setText =
    (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [key]: event.target.value }));

  const setFlag =
    (key: "allowStudentVendors" | "requireRegistryMatch") =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [key]: event.target.checked }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage(null);

    let payload: Record<string, unknown>;
    try {
      payload = {
        allowStudentVendors: values.allowStudentVendors,
        requireRegistryMatch: values.requireRegistryMatch,
        deliveryBaseFeeKobo: nairaToKobo(Number(values.baseFee)),
        deliveryPerKmKobo: nairaToKobo(Number(values.perKm)),
        deliveryMinimumFeeKobo: nairaToKobo(Number(values.minimumFee)),
        deliveryMaximumFeeKobo: nairaToKobo(Number(values.maximumFee)),
        commissionBps: Math.round(Number(values.commissionPercent) * 100),
        pickupWindowMinutes: Number(values.pickupWindowMinutes),
        studentWaitMinutes: Number(values.studentWaitMinutes),
        goodsPaymentWindowMinutes: Number(values.goodsPaymentWindowMinutes),
        announcement: values.announcement.trim() ? values.announcement.trim() : null,
      };
    } catch {
      setMessage({ ok: false, text: "Enter fees as plain numbers, e.g. 200 or 200.50." });
      return;
    }

    setSaving(true);
    try {
      await apiPatch("/api/admin/campus", payload);
      setMessage({ ok: true, text: "Settings saved. They apply to new orders only." });
      router.refresh();
    } catch (error) {
      setErrors(fieldErrors(error));
      setMessage({
        ok: false,
        text: error instanceof ApiClientError ? error.message : "The settings could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={onSubmit} noValidate>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Eligibility</legend>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={values.allowStudentVendors}
            onChange={setFlag("allowStudentVendors")}
            className="mt-1"
          />
          <span>
            Allow students to apply as vendors
            <span className="block text-xs opacity-60">
              When off, student accounts cannot submit a vendor application.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={values.requireRegistryMatch}
            onChange={setFlag("requireRegistryMatch")}
            className="mt-1"
          />
          <span>
            Require a registry match before approving a student
            <span className="block text-xs opacity-60">
              Only meaningful once you have imported the official student list.
            </span>
          </span>
        </label>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Delivery pricing (₦)</legend>
        <p className="text-xs opacity-60">
          Fee = base + (distance × per-kilometre rate), clamped between the minimum and maximum.
          Existing deliveries keep the fee they were created with.
        </p>

        <Field id="baseFee" label="Base fee" error={errors.deliveryBaseFeeKobo}>
          <Input value={values.baseFee} onChange={setText("baseFee")} inputMode="decimal" />
        </Field>

        <Field id="perKm" label="Per kilometre" error={errors.deliveryPerKmKobo}>
          <Input value={values.perKm} onChange={setText("perKm")} inputMode="decimal" />
        </Field>

        <Field id="minimumFee" label="Minimum fee" error={errors.deliveryMinimumFeeKobo}>
          <Input value={values.minimumFee} onChange={setText("minimumFee")} inputMode="decimal" />
        </Field>

        <Field id="maximumFee" label="Maximum fee" error={errors.deliveryMaximumFeeKobo}>
          <Input value={values.maximumFee} onChange={setText("maximumFee")} inputMode="decimal" />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Commission</legend>
        <Field
          id="commissionPercent"
          label="Platform commission (%)"
          hint="Stored as basis points, so 2.5 becomes 250. Changes are audited."
          error={errors.commissionBps}
        >
          <Input
            value={values.commissionPercent}
            onChange={setText("commissionPercent")}
            inputMode="decimal"
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold">Timers (minutes)</legend>

        <Field
          id="pickupWindowMinutes"
          label="Pickup window after an agent accepts"
          error={errors.pickupWindowMinutes}
        >
          <Input
            value={values.pickupWindowMinutes}
            onChange={setText("pickupWindowMinutes")}
            inputMode="numeric"
          />
        </Field>

        <Field
          id="studentWaitMinutes"
          label="Wait at the destination for an absent student"
          error={errors.studentWaitMinutes}
        >
          <Input
            value={values.studentWaitMinutes}
            onChange={setText("studentWaitMinutes")}
            inputMode="numeric"
          />
        </Field>

        <Field
          id="goodsPaymentWindowMinutes"
          label="Goods payment window after OTP verification"
          error={errors.goodsPaymentWindowMinutes}
        >
          <Input
            value={values.goodsPaymentWindowMinutes}
            onChange={setText("goodsPaymentWindowMinutes")}
            inputMode="numeric"
          />
        </Field>
      </fieldset>

      <Field
        id="announcement"
        label="Campus announcement (optional)"
        hint="Shown to everyone on this campus. Leave blank to remove it."
        error={errors.announcement}
      >
        <Input value={values.announcement} onChange={setText("announcement")} />
      </Field>

      {message ? (
        <p role="alert" className={message.ok ? "text-sm text-green-700" : "text-sm text-red-600"}>
          {message.text}
        </p>
      ) : null}

      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}
