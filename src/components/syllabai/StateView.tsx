"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, Brain, CalendarClock, TriangleAlert } from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { LearnerStateView } from "@/lib/types";

const bandClass: Record<string, string> = {
  LOW: "[&>div]:bg-rose-500",
  DEVELOPING: "[&>div]:bg-amber-500",
  SECURE: "[&>div]:bg-emerald-500",
};

export function StateView({
  state,
  loading,
  nodeTitles,
  misconceptionTitles,
}: {
  state: LearnerStateView | null;
  loading: boolean;
  nodeTitles: Record<string, string>;
  misconceptionTitles: Record<string, string>;
}) {
  if (loading && !state) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!state) {
    return (
      <Alert>
        <AlertTitle>No learner state yet</AlertTitle>
        <AlertDescription>
          Submit your first practice answer and your mastery estimates will appear here.
        </AlertDescription>
      </Alert>
    );
  }

  const forgotten = state.skillStates.filter((s) => s.effectiveMastery < s.mastery - 0.001);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="size-4 text-primary" aria-hidden="true" />
            Skill mastery (BKT)
          </CardTitle>
          <CardDescription>
            Stored mastery vs effective mastery after Ebbinghaus decay (τ = 30/90/365 days by
            proficiency band).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.skillStates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No skills practised yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[38%]">Topic</TableHead>
                    <TableHead>Mastery</TableHead>
                    <TableHead className="text-right">Attempts</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Last practice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.skillStates.map((s) => (
                    <TableRow key={s.nodeId}>
                      <TableCell className="font-medium">
                        {nodeTitles[s.nodeId] ?? s.nodeId.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={Math.round(s.effectiveMastery * 100)}
                            className={bandClass[s.band] ?? ""}
                            aria-label={`Mastery ${Math.round(s.effectiveMastery * 100)} percent`}
                          />
                          <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                            {Math.round(s.mastery * 100)}% → {Math.round(s.effectiveMastery * 100)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {s.correctCount}/{s.attempts}
                        {s.proceduralFluencyGap !== null && s.proceduralFluencyGap !== undefined && (
                          <span
                            className="ml-2"
                            title="Untimed accuracy minus timed accuracy (Paper B §16 fluency gap)"
                          >
                            Δ{s.proceduralFluencyGap >= 0 ? "+" : ""}
                            {s.proceduralFluencyGap.toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right text-xs text-muted-foreground sm:table-cell">
                        {formatRelative(s.lastPracticedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {forgotten.length > 0 && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
              <Activity className="size-3" aria-hidden="true" />
              {forgotten.length} topic{forgotten.length > 1 ? "s" : ""} showing decay since last
              practice — the nightly job schedules reviews when mastery crosses the threshold.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TriangleAlert className="size-4 text-amber-500" aria-hidden="true" />
            Misconception watch (BDT)
          </CardTitle>
          <CardDescription>
            Bayesian probabilities from distractor evidence — active above 0.5.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {state.misconceptionStates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No misconception signals yet — they appear when you pick a distractor that
              matches a documented misconception.
            </p>
          ) : (
            state.misconceptionStates.map((m) => (
              <div key={m.misconceptionNodeId} className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {misconceptionTitles[m.misconceptionNodeId] ?? m.misconceptionNodeId.slice(0, 8)}
                  </span>
                  {m.active ? (
                    <Badge className="bg-amber-500 hover:bg-amber-500">active</Badge>
                  ) : (
                    <Badge variant="outline">watching</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Progress
                    value={Math.round(m.probability * 100)}
                    className="[&>div]:bg-amber-500"
                    aria-label={`Misconception probability ${Math.round(m.probability * 100)} percent`}
                  />
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                    {m.probability.toFixed(2)} · {m.evidenceCount} hit
                    {m.evidenceCount === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-primary" aria-hidden="true" />
            Review queue
          </CardTitle>
          <CardDescription>Scheduled by the nightly forgetting-decay job.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.pendingReviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due — keep practising.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {state.pendingReviews.map((r, i) => (
                <li key={i} className="flex items-center justify-between rounded-md border px-3 py-1.5">
                  <span>{nodeTitles[r.nodeId] ?? r.nodeId.slice(0, 8)}</span>
                  <span className="text-xs text-muted-foreground">
                    due {formatRelative(r.dueAt).replace(" ago", "")} ago
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
