"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError, apiPost } from "@/lib/api/client";

export type ReviewableVendor = {
  id: string;
  storeName: string;
  ownerName: string;
  ownerEmail: string;
  phone: string;
  storefrontLocation: string;
  description: string | null;
  status: string;
  studentVendor: boolean;
  submittedAt: string | null;
  documents: { id: string; type: string }[];
};

type Decision = "APPROVE" | "REJECT" | "REQUEST_CORRECTION";

const DOCUMENT_LABELS: Record<string, string> = {
  VENDOR_STOREFRONT: "Storefront photograph",
  VENDOR_IDENTITY: "Identity / business document",
};

/**
 * Campus Admin vendor queue (PRD §17).
 *
 * Every button posts a decision to the server, which re-checks the reviewer's
 * campus, the application's current state and — for suspension — that the
 * vendor is actually approved. Nothing here is authoritative (Rule 29).
 */
export function VendorReviewList({
  vendors,
  mode,
}: {
  vendors: ReviewableVendor[];
  mode: "PENDING" | "APPROVED" | "SUSPENDED";
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function send(vendorId: string, path: string, body: Record<string, unknown>) {
    setBusyId(vendorId);
    setMessage(null);
    try {
      await apiPost(`/api/admin/vendors/${vendorId}/${path}`, body);
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof ApiClientError ? error.message : "That action could not be completed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function review(vendorId: string, decision: Decision) {
    const note = notes[vendorId]?.trim();
    if (decision !== "APPROVE" && !note) {
      setMessage("Add a note explaining what the vendor needs to correct.");
      return;
    }
    await send(vendorId, "review", { decision, note });
  }

  async function changeStatus(vendorId: string, action: "SUSPEND" | "REINSTATE") {
    const reason = notes[vendorId]?.trim();
    if (action === "SUSPEND" && !reason) {
      setMessage("Add a reason before suspending a store.");
      return;
    }
    await send(vendorId, "status", { action, reason });
  }

  if (vendors.length === 0) {
    return (
      <p className="text-sm opacity-70">
        {mode === "PENDING"
          ? "No vendor applications are waiting for review."
          : "No stores to show here yet."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}

      {vendors.map((vendor) => (
        <Card key={vendor.id}>
          <CardHeader>
            <CardTitle>{vendor.storeName}</CardTitle>
            <p className="text-sm opacity-70">
              {vendor.ownerName} · {vendor.ownerEmail}
              {vendor.studentVendor ? " · student vendor" : ""}
            </p>
          </CardHeader>

          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="opacity-60">Phone</dt>
              <dd>{vendor.phone}</dd>
              <dt className="opacity-60">Storefront</dt>
              <dd>{vendor.storefrontLocation}</dd>
              <dt className="opacity-60">Description</dt>
              <dd>{vendor.description ?? "—"}</dd>
              <dt className="opacity-60">Submitted</dt>
              <dd>{vendor.submittedAt ? new Date(vendor.submittedAt).toLocaleString() : "—"}</dd>
            </dl>

            <div className="flex flex-wrap gap-3 text-sm">
              {vendor.documents.map((document) => (
                <a
                  key={document.id}
                  href={`/api/students/documents/${document.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {DOCUMENT_LABELS[document.type] ?? document.type}
                </a>
              ))}
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">
                {mode === "PENDING"
                  ? "Note (required to reject or request a correction)"
                  : "Reason (required to suspend)"}
              </span>
              <textarea
                value={notes[vendor.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [vendor.id]: event.target.value }))
                }
                rows={2}
                className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {mode === "PENDING" ? (
                <>
                  <Button onClick={() => review(vendor.id, "APPROVE")} disabled={busyId === vendor.id}>
                    Approve
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => review(vendor.id, "REQUEST_CORRECTION")}
                    disabled={busyId === vendor.id}
                  >
                    Request correction
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => review(vendor.id, "REJECT")}
                    disabled={busyId === vendor.id}
                  >
                    Reject
                  </Button>
                </>
              ) : null}

              {mode === "APPROVED" ? (
                <Button
                  variant="danger"
                  onClick={() => changeStatus(vendor.id, "SUSPEND")}
                  disabled={busyId === vendor.id}
                >
                  Suspend store
                </Button>
              ) : null}

              {mode === "SUSPENDED" ? (
                <Button
                  onClick={() => changeStatus(vendor.id, "REINSTATE")}
                  disabled={busyId === vendor.id}
                >
                  Reinstate store
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
