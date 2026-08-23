"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionHeader, Stat } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/sheet";
import { EmptyState, Notice } from "@/components/ui/state";
import { useToast } from "@/components/ui/toast";
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
  const toast = useToast();

  const [form, setForm] = useState({ code: "", name: "", city: "", state: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(campuses.length === 0);

  const [adminEmail, setAdminEmail] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Deactivation is confirmed, activation is not.
   *
   * Switching a campus to INACTIVE signs out every student, vendor and agent on
   * it and stops the marketplace dead. It sat behind a single unguarded click,
   * one row away from "Assign", with no statement of how many people it affects.
   * Activation is harmless and stays immediate.
   */
  const [pendingDeactivation, setPendingDeactivation] = useState<CampusRow | null>(null);

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
      const created = form.code.trim().toUpperCase();
      setForm({ code: "", name: "", city: "", state: "" });
      setShowCreate(false);
      toast.success(`${created} created. Assign a campus admin to open it up.`);
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

  async function setStatus(campus: CampusRow, status: "ACTIVE" | "INACTIVE") {
    setBusyId(campus.id);
    try {
      await apiPost(`/api/super-admin/campuses/${campus.id}/status`, { status });
      setPendingDeactivation(null);
      toast.success(
        status === "ACTIVE" ? `${campus.code} is live again.` : `${campus.code} is now closed.`,
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "The status could not be changed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function assignAdmin(campus: CampusRow) {
    const email = adminEmail[campus.id]?.trim();
    if (!email) {
      toast.error("Enter the admin's email address.");
      return;
    }

    setBusyId(campus.id);
    try {
      await apiPost(`/api/super-admin/campuses/${campus.id}/admins`, { email });
      setAdminEmail((current) => ({ ...current, [campus.id]: "" }));
      toast.success(`${email} now administers ${campus.code}.`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "The admin could not be assigned.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const active = campuses.filter((campus) => campus.status === "ACTIVE").length;
  const students = campuses.reduce((sum, campus) => sum + campus.counts.students, 0);

  return (
    <div className="space-y-8">
      {/*
       * Portfolio totals first. A Super Admin opening this page is asking "how is
       * the platform doing" before "let me edit a campus", and the answer was
       * previously only derivable by reading every row.
       */}
      {campuses.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Campuses" value={String(campuses.length)} />
          <Stat label="Live" value={String(active)} />
          <Stat label="Students" value={students.toLocaleString("en-NG")} />
        </div>
      ) : null}

      <section className="space-y-4">
        <SectionHeader
          title="Campuses"
          description="Each campus is an isolated marketplace with its own vendors, agents and settings."
          action={
            campuses.length > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowCreate((open) => !open)}
                aria-expanded={showCreate}
              >
                {showCreate ? "Cancel" : "New campus"}
              </Button>
            ) : undefined
          }
        />

        {/*
         * The create form used to occupy the top of the page permanently, which
         * pushed the campuses themselves below the fold — wrong priority for a
         * form used once per university.
         */}
        {showCreate ? (
          <Card>
            <CardHeader>
              <CardTitle>Create a campus</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={createCampus} noValidate>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    id="code"
                    label="Campus code"
                    hint="Short and permanent, e.g. ABUAD."
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
                    <Input
                      value={form.city}
                      onChange={update("city")}
                      placeholder="Ado-Ekiti"
                      required
                    />
                  </Field>

                  <Field id="state" label="State (optional)" error={errors.state}>
                    <Input value={form.state} onChange={update("state")} placeholder="Ekiti" />
                  </Field>
                </div>

                {createMessage ? <Notice tone="danger">{createMessage}</Notice> : null}

                <Button type="submit" isLoading={creating} loadingLabel="Creating…">
                  Create campus
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {campuses.length === 0 && !showCreate ? (
          <EmptyState
            title="No campuses yet"
            description="Create the first campus to open the platform."
            action={<Button onClick={() => setShowCreate(true)}>Create a campus</Button>}
          />
        ) : null}

        <div className="space-y-3">
          {campuses.map((campus) => {
            const busy = busyId === campus.id;
            const place = [campus.city, campus.state].filter(Boolean).join(", ");
            const isActive = campus.status === "ACTIVE";
            /*
             * A campus with no admin cannot verify a single student, so nothing
             * on it can move. That is worth surfacing on the row rather than
             * leaving it to be inferred from "0 admins".
             */
            const unmanaged = campus.counts.admins === 0;

            return (
              <Card key={campus.id} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-display text-lg font-semibold text-ink">
                        {campus.name}
                      </h3>
                      <Badge tone="neutral" className="font-mono">
                        {campus.code}
                      </Badge>
                      <Badge tone={isActive ? "success" : "warning"}>
                        {isActive ? "Live" : "Closed"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {place} · {campus.counts.students.toLocaleString("en-NG")} students ·{" "}
                      {campus.counts.admins} {campus.counts.admins === 1 ? "admin" : "admins"}
                    </p>
                  </div>

                  <Button
                    variant={isActive ? "ghost" : "primary"}
                    size="sm"
                    onClick={() =>
                      isActive ? setPendingDeactivation(campus) : setStatus(campus, "ACTIVE")
                    }
                    disabled={busy}
                  >
                    {isActive ? "Close campus" : "Reopen campus"}
                  </Button>
                </div>

                {unmanaged ? (
                  <Notice tone="warning">
                    No campus admin yet. Student and vendor verifications cannot be processed until
                    one is assigned.
                  </Notice>
                ) : null}

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <Field
                    id={`admin-${campus.id}`}
                    label="Assign a campus admin"
                    hint="The account must already exist with a confirmed email address."
                    className="flex-1"
                  >
                    <Input
                      value={adminEmail[campus.id] ?? ""}
                      onChange={(event) =>
                        setAdminEmail((current) => ({
                          ...current,
                          [campus.id]: event.target.value,
                        }))
                      }
                      type="email"
                      placeholder="admin@example.com"
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    onClick={() => assignAdmin(campus)}
                    disabled={busy}
                    className="sm:mb-6"
                  >
                    Assign
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <ConfirmDialog
        open={pendingDeactivation !== null}
        onClose={() => setPendingDeactivation(null)}
        onConfirm={() => {
          if (pendingDeactivation) void setStatus(pendingDeactivation, "INACTIVE");
        }}
        tone="danger"
        title={`Close ${pendingDeactivation?.code ?? "this campus"}?`}
        description={
          pendingDeactivation
            ? `${pendingDeactivation.counts.students.toLocaleString("en-NG")} students and every vendor and delivery agent on ${pendingDeactivation.name} will lose access immediately, and the marketplace will stop taking orders. You can reopen it at any time.`
            : undefined
        }
        confirmLabel="Close campus"
        cancelLabel="Keep it open"
        isLoading={busyId === pendingDeactivation?.id}
      />
    </div>
  );
}
