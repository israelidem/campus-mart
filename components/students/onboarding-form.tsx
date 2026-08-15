"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { ApiClientError, apiPost, apiUpload, fieldErrors } from "@/lib/api/client";

type UploadedDocument = { id: string; type: string };

/**
 * Student verification submission (PRD §13–14).
 *
 * Files are uploaded first to obtain private document ids, then the details are
 * submitted. Nothing here is trusted by the server: campus, status and registry
 * matching are all decided server-side.
 */
export function OnboardingForm({
  initial,
}: {
  initial: { matricNumber: string; studentIdNumber: string; department: string; level: string };
}) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial, phone: "" });
  const [passport, setPassport] = useState<File | null>(null);
  const [idCard, setIdCard] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function upload(type: string, file: File): Promise<string> {
    const body = new FormData();
    body.set("type", type);
    body.set("file", file);
    const result = await apiUpload<{ document: UploadedDocument }>("/api/students/documents", body);
    return result.document.id;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setMessage(null);

    if (!passport || !idCard) {
      setMessage("Attach both your passport photograph and your student ID.");
      return;
    }

    setSubmitting(true);
    try {
      const [passportDocumentId, studentIdDocumentId] = await Promise.all([
        upload("STUDENT_PASSPORT_PHOTO", passport),
        upload("STUDENT_ID_CARD", idCard),
      ]);

      await apiPost("/api/students/profile", {
        matricNumber: form.matricNumber,
        studentIdNumber: form.studentIdNumber || undefined,
        department: form.department || undefined,
        level: form.level || undefined,
        phone: form.phone || undefined,
        passportDocumentId,
        studentIdDocumentId,
      });

      router.refresh();
    } catch (error) {
      setErrors(fieldErrors(error));
      setMessage(
        error instanceof ApiClientError ? error.message : "Submission failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <Field
        id="matricNumber"
        label="Matric number"
        hint="Exactly as it appears on your student ID, e.g. 25/LAW01/001."
        error={errors.matricNumber}
      >
        <Input value={form.matricNumber} onChange={update("matricNumber")} required />
      </Field>

      <Field id="studentIdNumber" label="Student ID number (optional)" error={errors.studentIdNumber}>
        <Input value={form.studentIdNumber} onChange={update("studentIdNumber")} />
      </Field>

      <Field id="department" label="Department (optional)" error={errors.department}>
        <Input value={form.department} onChange={update("department")} />
      </Field>

      <Field id="level" label="Level (optional)" error={errors.level}>
        <Input value={form.level} onChange={update("level")} placeholder="e.g. 200" />
      </Field>

      <Field id="phone" label="Phone number (optional)" error={errors.phone}>
        <Input
          value={form.phone}
          onChange={update("phone")}
          inputMode="tel"
          placeholder="+2348012345678"
        />
      </Field>

      <Field
        id="passport"
        label="Passport photograph"
        hint="JPEG, PNG, WebP or PDF, up to 5 MB. Only you and your campus admin can view it."
      >
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(event) => setPassport(event.target.files?.[0] ?? null)}
          required
          className="block w-full text-sm"
        />
      </Field>

      <Field id="idCard" label="Student ID card" hint="JPEG, PNG, WebP or PDF, up to 5 MB.">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={(event) => setIdCard(event.target.files?.[0] ?? null)}
          required
          className="block w-full text-sm"
        />
      </Field>

      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Submitting…" : "Submit for verification"}
      </Button>
    </form>
  );
}
