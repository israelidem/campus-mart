"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ApiClientError, apiPost, fieldErrors } from "@/lib/api/client";

export type CampusRow = {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string | null;
  status: "ACTIVE" | "INACTIVE";
  counts: { students: number; admins: number };
};

/**
 * Super Admin campus management (PRD §9, §11).
 *
 * Creation, activation and admin assignment all post to the server, which is
 * where the Super Admin role is actually enforced; this component only shows
 * what the server already allowed.
 */
export function CampusManager({ campuses }: { campuses: CampusRow[] }) {
  const router = useRouter();

  const [form, setForm] = useState({ code: "", name: "", city: "", state: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [adminEmail, setAdminEmail] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: string; text: string; ok: boolean } | null>(
    null,
  );

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  async function createCampus(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    setCreateMessage(null);
    setCreating(true);
    try {
      await apiPost("/api/super-admin/campuses", {
        code: form.code,
        name: form.name,
        city: form.city,
        state: form.state || undefined,
      });
      setForm({ code: "", name: "", city: "", state: "" });
      router.refresh();
    } catch (error) {
      setErrors(fieldErrors(error));
      setCreateMessage(
        error instanceof ApiClientError ? error.message : "The campus could not be created.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(campus: CampusRow) {
    setBusyId(campus.id);
    setRowMessage(null);
    try {
      await apiPost(`/api/super-admin/campuses/${campus.id}/status`, {
        status: campus.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      });
      router.refresh();
    } catch (error) {
      setRowMessage({
        id: campus.id,
        ok: false,
        text: error instanceof ApiClientError ? error.message : "The status could not be changed.",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function assignAdmin(campus: CampusRow) {
    const email = adminEmail[campus.id]?.trim();
    if (!email) {
      setRowMessage({ id: campus.id, ok: false, text: "Enter the admin's email address." });
      return;
    }

    setBusyId(campus.id);
    setRowMessage(null);
    try {
      await apiPost(`/api/super-admin/campuses/${campus.id}/admins`, { email });
      setAdminEmail((current) => ({ ...current, [campus.id]: "" }));
      setRowMessage({ id: campus.id, ok: true, text: `${email} now administers ${campus.code}.` });
      router.refresh();
    } catch (error) {
      setRowMessage({
        id: campus.id,
        ok: false,
        text: error instanceof ApiClientError ? error.message : "The admin could not be assigned.",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create a campus</CardTitle>
          <CardDescription>
            Each campus is an isolated marketplace. Its settings are created with it and can be
            tuned by the campus admin.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form className="space-y-4" onSubmit={createCampus} noValidate>
            <Field
              id="code"
              label="Campus code"
              hint="Short and permanent, e.g. ABUAD. Cannot be changed later."
              error={errors.code}
            >
              <Input value={form.code} onChange={update("code")} required />
            </Field>

            <Field id="name" label="Campus name" error={errors.name}>
              <Input
                value={form.name}
                onChange={update("name")}
                placeholder="Afe Babalola University"
                required
              />
            </Field>

            <Field id="city" label="City" error={errors.city}>
              <Input value={form.city} onChange={update("city")} placeholder="Ado-Ekiti" required />
            </Field>

            <Field id="state" label="State (optional)" error={errors.state}>
              <Input value={form.state} onChange={update("state")} placeholder="Ekiti" />
            </Field>

            {createMessage ? (
              <p role="alert" className="text-sm text-red-600">
                {createMessage}
              </p>
            ) : null}

            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create campus"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Campuses</h2>

        {campuses.length === 0 ? (
          <p className="text-sm opacity-70">No campuses yet. Create the first one above.</p>
        ) : (
          campuses.map((campus) => (
            <Card key={campus.id}>
              <CardHeader>
                <CardTitle>
                  {campus.name} ({campus.code})
                </CardTitle>
                <p className="text-sm opacity-70">
                  {[campus.city, campus.state].filter(Boolean).join(", ")} · {campus.status} ·{" "}
                  {campus.counts.students} students · {campus.counts.admins} admins
                </p>
              </CardHeader>

              <CardContent>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex-1 space-y-1.5">
                    <span className="text-sm font-medium">Assign a Campus Admin by email</span>
                    <Input
                      value={adminEmail[campus.id] ?? ""}
                      onChange={(event) =>
                        setAdminEmail((current) => ({ ...current, [campus.id]: event.target.value }))
                      }
                      type="email"
                      placeholder="admin@example.com"
                    />
                  </label>
                  <Button
                    variant="secondary"
                    onClick={() => assignAdmin(campus)}
                    disabled={busyId === campus.id}
                  >
                    Assign
                  </Button>
                  <Button
                    variant={campus.status === "ACTIVE" ? "danger" : "primary"}
                    onClick={() => toggleStatus(campus)}
                    disabled={busyId === campus.id}
                  >
                    {campus.status === "ACTIVE" ? "Deactivate" : "Activate"}
                  </Button>
                </div>

                <p className="text-xs opacity-60">
                  The account must already exist and have a confirmed email address.
                </p>

                {rowMessage?.id === campus.id ? (
                  <p
                    role="alert"
                    className={rowMessage.ok ? "text-sm text-green-700" : "text-sm text-red-600"}
                  >
                    {rowMessage.text}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
