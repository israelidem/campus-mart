"use client";

import { useState } from "react";

import { ApiClientError, apiPatch } from "@/lib/api/client";

/**
 * The Campus Admin's queue of delivery-agent applications.
 *
 * The list arrives already scoped to the admin's campus by the server; this
 * component only sends decisions and shows what came back. Agents flagged by
 * repeated cancellations are surfaced here rather than suspended automatically,
 * because Rule 27 escalates to a human.
 */

type Agent = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  cancellationCount: number;
  isWarned: boolean;
  isUnderReview: boolean;
  reviewNote: string | null;
};

type Decision = "APPROVE" | "REJECT" | "REQUEST_CORRECTION" | "SUSPEND" | "REINSTATE";

const DECISIONS: Record<string, { decision: Decision; label: string; needsNote: boolean }[]> = {
  PENDING_VERIFICATION: [
    { decision: "APPROVE", label: "Approve", needsNote: false },
    { decision: "REQUEST_CORRECTION", label: "Ask for a correction", needsNote: true },
    { decision: "REJECT", label: "Reject", needsNote: true },
  ],
  APPROVED: [{ decision: "SUSPEND", label: "Suspend", needsNote: true }],
  SUSPENDED: [{ decision: "REINSTATE", label: "Reinstate", needsNote: false }],
  CORRECTION_REQUESTED: [{ decision: "REJECT", label: "Reject", needsNote: true }],
  REJECTED: [],
};

export function AgentReviewQueue({ initialAgents }: { initialAgents: Agent[] }) {
  const [agents, setAgents] = useState(initialAgents);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(agent: Agent, decision: Decision, needsNote: boolean) {
    const note = needsNote
      ? window.prompt("Tell the applicant what to do next")?.trim()
      : undefined;
    if (needsNote && !note) return;

    setBusy(true);
    setMessage(null);
    try {
      const result = await apiPatch<{ agent: Agent }>(`/api/admin/agents/${agent.id}`, {
        decision,
        ...(note ? { note } : {}),
      });
      setAgents((current) =>
        current.map((row) => (row.id === agent.id ? { ...row, ...result.agent } : row)),
      );
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">No delivery agents on this campus yet.</p>;
  }

  return (
    <div className="space-y-4">
      {message ? <p className="text-sm text-destructive">{message}</p> : null}

      <ul className="space-y-3">
        {agents.map((agent) => (
          <li className="rounded-lg border p-4" key={agent.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium">{agent.name}</p>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {agent.status.replaceAll("_", " ")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {agent.email} · {agent.phone}
            </p>

            {agent.isUnderReview ? (
              <p className="mt-2 rounded-md bg-destructive/10 p-2 text-sm">
                Flagged for review: {agent.cancellationCount} cancellations.
              </p>
            ) : agent.isWarned ? (
              <p className="mt-2 text-sm text-amber-700">
                Warned after {agent.cancellationCount} cancellations.
              </p>
            ) : null}

            {agent.reviewNote ? (
              <p className="mt-2 text-sm">Last note: {agent.reviewNote}</p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {(DECISIONS[agent.status] ?? []).map((option) => (
                <button
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={busy}
                  key={option.decision}
                  onClick={() => void decide(agent, option.decision, option.needsNote)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
