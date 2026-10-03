"use client";

/**
 * T-C76 consumer: the learner agenda (Spec §22 GET /api/v1/learners/me/agenda).
 *
 * This card renders the composition's ASSIGNMENTS block — the piece the
 * dashboard had no surface for (the work the teacher set + the learner's own
 * append-only hand-in trail, ordered due-soonest-first, undated last by the
 * server). The agenda's reviews and actions blocks are served by their
 * dedicated cards ("Due reviews", "Focus areas" + NextBestActionsCard): the
 * server composes once, the dashboard renders each block where it belongs.
 *
 * Facts, not advice: every row is a real assignment row under the V51
 * visibility rule (class work only for members), and the hand-in state is
 * the learner's own trail — never mastery, never a prediction. Derived
 * "overdue" is client-side presentation over the server's dueAt (the server
 * deliberately keeps one vocabulary for the fact). A fetch failure shows an
 * honest error in this card and must never break the dashboard.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, CircleCheck } from "lucide-react";
import { formatDue, humanizeCode } from "@/lib/format";
import { api } from "@/lib/api";
import type { AgendaView } from "@/lib/types";

export function AgendaPanel() {
  const [agenda, setAgenda] = useState<AgendaView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setAgenda(null);
    setError(null);
    api
      .agenda()
      .then((a) => {
        if (alive) setAgenda(a);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "agenda unavailable");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="size-4 text-primary" aria-hidden="true" />
          Set work
        </CardTitle>
        <CardDescription>Assigned by your teacher, due-soonest first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? (
          <p className="text-sm text-muted-foreground">Set work is unavailable right now.</p>
        ) : agenda === null ? (
          <div className="space-y-1.5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : agenda.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No set work yet — assignments your teacher sets will appear here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {agenda.assignments.map(({ assignment, mySubmission }) => {
              const overdue =
                assignment.status === "open" &&
                assignment.dueAt !== null &&
                assignment.dueAt < new Date().toISOString();
              return (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{assignment.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {assignment.courseLabel}
                      {assignment.dueAt
                        ? ` · ${formatDue(assignment.dueAt)}`
                        : " · no due date"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {assignment.status === "closed" && (
                      <Badge variant="outline" className="text-xs">
                        {humanizeCode("closed")}
                      </Badge>
                    )}
                    {overdue && !mySubmission && (
                      <Badge variant="outline" className="text-xs text-rose-600 dark:text-rose-400">
                        Overdue
                      </Badge>
                    )}
                    {mySubmission ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CircleCheck className="size-3.5" aria-hidden="true" />
                        Handed in
                        {mySubmission.score !== null
                          ? ` · ${mySubmission.score}/${assignment.marksTotal}`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
