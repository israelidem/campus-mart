"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError, apiPost } from "@/lib/api/client";

export type ReviewableStudent = {
  id: string;
  name: string;
  email: string;
  matricNumber: string;
  studentIdNumber: string | null;
  department: string | null;
  level: string | null;
  registryMatched: boolean;
  submittedAt: string | null;
  documents: { id: string; type: string }[];
};

type Decision = "APPROVE" | "REJECT" | "REQUEST_CORRECTION";

/**
 * Campus Admin verification queue (PRD §14).
 *
 * Decisions are posted to the server, which re-checks the reviewer's campus and
 * the submission's current state before applying anything.
 */
export function StudentReviewList({ students }: { students: ReviewableStudent[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function review(studentProfileId: string, decision: Decision) {
    const note = notes[studentProfileId]?.trim();
    if (decision !== "APPROVE" && !note) {
      setMessage("Add a note explaining what the student needs to correct.");
      return;
    }

    setBusyId(studentProfileId);
    setMessage(null);
    try {
      await apiPost(`/api/admin/students/${studentProfileId}/review`, { decision, note });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "The review could not be saved.");
    } finally {
      setBusyId(null);
    }
  }

  if (students.length === 0) {
    return <p className="text-sm opacity-70">No submissions are waiting for review.</p>;
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      ) : null}

      {students.map((student) => (
        <Card key={student.id}>
          <CardHeader>
            <CardTitle>{student.name}</CardTitle>
            <p className="text-sm opacity-70">{student.email}</p>
          </CardHeader>

          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="opacity-60">Matric number</dt>
              <dd>{student.matricNumber}</dd>
              <dt className="opacity-60">Student ID number</dt>
              <dd>{student.studentIdNumber ?? "—"}</dd>
              <dt className="opacity-60">Department / level</dt>
              <dd>
                {student.department ?? "—"} {student.level ? `· ${student.level}` : ""}
              </dd>
              <dt className="opacity-60">Registry match</dt>
              <dd>{student.registryMatched ? "Found in registry" : "Not in registry"}</dd>
              <dt className="opacity-60">Submitted</dt>
              <dd>{student.submittedAt ? new Date(student.submittedAt).toLocaleString() : "—"}</dd>
            </dl>

            <div className="flex flex-wrap gap-3 text-sm">
              {student.documents.map((document) => (
                <a
                  key={document.id}
                  href={`/api/students/documents/${document.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {document.type === "STUDENT_PASSPORT_PHOTO" ? "Passport photograph" : "Student ID"}
                </a>
              ))}
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Note (required to reject or request a correction)</span>
              <textarea
                value={notes[student.id] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({ ...current, [student.id]: event.target.value }))
                }
                rows={2}
                className="w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => review(student.id, "APPROVE")}
                disabled={busyId === student.id}
              >
                Approve
              </Button>
              <Button
                variant="secondary"
                onClick={() => review(student.id, "REQUEST_CORRECTION")}
                disabled={busyId === student.id}
              >
                Request correction
              </Button>
              <Button
                variant="danger"
                onClick={() => review(student.id, "REJECT")}
                disabled={busyId === student.id}
              >
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
