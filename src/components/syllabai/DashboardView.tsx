"use client";

/**
 * F-060: personal student dashboard (T-028). Every card renders REAL read-model
 * data (F-034 personalized graph + /learners/me/state) — no invented
 * recommendations, no fabricated predictions: "Focus areas" is a sorted
 * presentation of measured mastery (facts, not policy — the recommendation
 * package stays empty), and predicted grade renders an explicit
 * not-yet-implemented state rather than an invented number.
 */
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Activity,
  Brain,
  CalendarClock,
  Compass,
  Gauge,
  MessageCircleQuestion,
  Network,
  Target,
  TriangleAlert,
} from "lucide-react";
import { formatDue, formatRelative, humanizeCode } from "@/lib/format";
import { NextBestActionsCard } from "@/components/syllabai/NextBestActionsCard";
import type {
  LearnerKnowledgeGraphView,
  LearnerNodeWithStateView,
  LearnerStateView,
  NextBestActionsView,
} from "@/lib/types";

const bandProgressClass: Record<string, string> = {
  LOW: "[&>div]:bg-rose-500",
  DEVELOPING: "[&>div]:bg-amber-500",
  SECURE: "[&>div]:bg-emerald-500",
};

function bandChipClass(band: string): string {
  if (band === "SECURE") return "border-emerald-500/40 text-emerald-700 dark:text-emerald-400";
  if (band === "DEVELOPING") return "border-amber-500/40 text-amber-700 dark:text-amber-400";
  return "border-rose-500/40 text-rose-700 dark:text-rose-400";
}

function PractiseButton({
  node,
  onPracticeTopic,
}: {
  node: LearnerNodeWithStateView;
  onPracticeTopic: (nodeId: string, title: string) => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 shrink-0 text-xs"
      onClick={() => onPracticeTopic(node.id, node.title)}
    >
      Practise
    </Button>
  );
}

export function DashboardView({
  graph,
  state,
  loading,
  recommendations,
  recommendationsLoading,
  recommendationsError,
  onPracticeTopic,
  onOpenMap,
  onAskTutor,
}: {
  graph: LearnerKnowledgeGraphView | null;
  state: LearnerStateView | null;
  loading: boolean;
  recommendations: NextBestActionsView | null;
  recommendationsLoading: boolean;
  recommendationsError: string | null;
  onPracticeTopic: (nodeId: string, title: string) => void;
  onOpenMap: () => void;
  onAskTutor: () => void;
}) {
  const summary = useMemo(() => {
    if (!graph) return null;
    const topics = graph.nodes.filter(
      (n) => n.type === "TOPIC" || n.type === "SUBTOPIC",
    );
    const practised = topics.filter((n) => n.effectiveMastery !== null);
    const counts = { SECURE: 0, DEVELOPING: 0, LOW: 0 } as Record<string, number>;
    for (const n of practised) {
      if (n.band) counts[n.band] = (counts[n.band] ?? 0) + 1;
    }
    const avgEffective =
      practised.length === 0
        ? null
        : practised.reduce((acc, n) => acc + (n.effectiveMastery ?? 0), 0) / practised.length;
    return { total: topics.length, practised: practised.length, counts, avgEffective };
  }, [graph]);

  const reviews = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => n.reviewDueAt !== null)
      .sort((a, b) => (a.reviewDueAt! < b.reviewDueAt! ? -1 : 1));
  }, [graph]);

  const focus = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => (n.type === "TOPIC" || n.type === "SUBTOPIC") && n.effectiveMastery !== null)
      .sort((a, b) => (a.effectiveMastery ?? 0) - (b.effectiveMastery ?? 0))
      .slice(0, 5);
  }, [graph]);

  const misconceptions = useMemo(() => {
    if (!graph || !state) return [];
    const titles = new Map(graph.nodes.map((n) => [n.id, n.title]));
    return state.misconceptionStates
      .filter((m) => m.active)
      .map((m) => ({
        ...m,
        title: titles.get(m.misconceptionNodeId) ?? m.misconceptionNodeId.slice(0, 8),
      }));
  }, [graph, state]);

  // V21 (P7): topics the learner recently asked the Tutor about — the dashboard's
  // "continue what you were curious about" hook. Titles resolve against the
  // personalized graph first (richer), falling back to the backend-resolved title.
  const recentAsks = useMemo(() => {
    if (!state?.tutorEngagements?.length) return [];
    const titles = new Map((graph?.nodes ?? []).map((n) => [n.id, n.title]));
    return state.tutorEngagements.map((e) => ({
      ...e,
      title: titles.get(e.nodeId) ?? e.nodeTitle ?? e.nodeId.slice(0, 8),
    }));
  }, [graph, state]);

  const activity = useMemo(() => {
    if (!graph) return null;
    const practised = graph.nodes.filter((n) => n.attempts !== null);
    const attempts = practised.reduce((acc, n) => acc + (n.attempts ?? 0), 0);
    const correct = practised.reduce((acc, n) => acc + (n.correctCount ?? 0), 0);
    const last = practised
      .filter((n) => n.lastPracticedAt)
      .sort((a, b) => (a.lastPracticedAt! < b.lastPracticedAt! ? 1 : -1))[0];
    return { attempts, correct, last };
  }, [graph]);

  if (loading && !graph) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-44 w-full" />
      </div>
    );
  }

  if (!graph) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Dashboard unavailable</AlertTitle>
        <AlertDescription>
          Your personalized graph could not be loaded — try signing in again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Next best actions — T-033 ranked advice derived from evidence (ADVICE,
            deliberately distinct from the measured-fact cards below) */}
        <NextBestActionsCard
          view={recommendations}
          loading={recommendationsLoading}
          error={recommendationsError}
          onPracticeTopic={onPracticeTopic}
          onAskTutor={onAskTutor}
        />

        {/* Mastery summary — facts from the personalized graph */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="size-4 text-primary" aria-hidden="true" />
              Mastery summary
            </CardTitle>
            <CardDescription>
              {graph.rootTitle} · {summary?.practised ?? 0} of {summary?.total ?? 0} topics
              practised
              {graph.asOf && ` · estimates as of ${new Date(graph.asOf).toLocaleDateString()}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary && summary.practised > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={bandChipClass("SECURE")}>
                    {summary.counts.SECURE} secure
                  </Badge>
                  <Badge variant="outline" className={bandChipClass("DEVELOPING")}>
                    {summary.counts.DEVELOPING} developing
                  </Badge>
                  <Badge variant="outline" className={bandChipClass("LOW")}>
                    {summary.counts.LOW} low
                  </Badge>
                  <Badge variant="outline">
                    {summary.total - summary.practised} not practised
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Progress
                    value={Math.round((summary.avgEffective ?? 0) * 100)}
                    aria-label={`Average effective mastery ${Math.round((summary.avgEffective ?? 0) * 100)} percent`}
                  />
                  <span className="w-36 shrink-0 text-right text-muted-foreground">
                    avg effective {Math.round((summary.avgEffective ?? 0) * 100)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Effective mastery = BKT estimate after Ebbinghaus decay since last practice.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing practised yet — answer your first question and the map starts filling in.
              </p>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onOpenMap}>
              <Network className="mr-1 size-3.5" aria-hidden="true" />
              Open the mastery map
            </Button>
          </CardContent>
        </Card>

        {/* Due reviews — the forgetting-decay schedule */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4 text-primary" aria-hidden="true" />
              Due reviews
            </CardTitle>
            <CardDescription>Scheduled by the nightly forgetting-decay job.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing due — the decay schedule is clear. Keep practising.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {reviews.map((r) => {
                  const overdue = r.reviewDueAt! < new Date().toISOString();
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{r.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanizeCode(r.reviewReason ?? "review")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`text-xs ${overdue ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}
                        >
                          {formatDue(r.reviewDueAt!)}
                        </span>
                        <PractiseButton node={r} onPracticeTopic={onPracticeTopic} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Focus areas — measured facts, explicitly not recommendations */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4 text-primary" aria-hidden="true" />
              Focus areas
            </CardTitle>
            <CardDescription>
              Your lowest measured mastery — presented as facts, not recommendations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {focus.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No practised topics yet — focus areas appear once you have mastery estimates.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {focus.map((n) => (
                  <li
                    key={n.id}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{n.title}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs">
                        <Progress
                          value={Math.round((n.effectiveMastery ?? 0) * 100)}
                          className={bandProgressClass[n.band ?? ""] ?? ""}
                          aria-label={`Mastery ${Math.round((n.effectiveMastery ?? 0) * 100)} percent`}
                        />
                        <span className="w-24 shrink-0 text-right text-muted-foreground">
                          {Math.round((n.effectiveMastery ?? 0) * 100)}% ·{" "}
                          {n.band?.toLowerCase()}
                        </span>
                      </div>
                    </div>
                    <PractiseButton node={n} onPracticeTopic={onPracticeTopic} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Misconception watch — BDT probabilities from real distractor evidence */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4 text-amber-500" aria-hidden="true" />
              Misconception watch
            </CardTitle>
            <CardDescription>
              Bayesian probabilities from distractor evidence — active above 0.5.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {misconceptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active misconceptions — they appear when a chosen distractor matches a
                documented misconception.
              </p>
            ) : (
              misconceptions.slice(0, 4).map((m) => (
                <div
                  key={m.misconceptionNodeId}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                >
                  <p className="min-w-0 truncate text-sm">{m.title}</p>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>{m.probability.toFixed(2)}</span>
                    <span>· {m.evidenceCount} hit{m.evidenceCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recently asked — V21 tutor engagement: continue what you were curious about */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircleQuestion className="size-4 text-primary" aria-hidden="true" />
              Recently asked
            </CardTitle>
            <CardDescription>
              Topics from your Tutor questions in the last 30 days — practising them is
              the natural next step.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentAsks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing yet — ask the Tutor a question and the topics you touch will
                show up here.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {recentAsks.slice(0, 6).map((e) => {
                  const node = graph.nodes.find((n) => n.id === e.nodeId);
                  return (
                    <li
                      key={e.nodeId}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{e.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.asks} question{e.asks === 1 ? "" : "s"} · last{" "}
                          {formatRelative(e.lastAskedAt)}
                          {e.refusedAny ? " · some unanswered (no grounded material)" : ""}
                        </p>
                      </div>
                      {node && (
                        <PractiseButton node={node} onPracticeTopic={onPracticeTopic} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent activity — measured totals */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" aria-hidden="true" />
              Recent activity
            </CardTitle>
            <CardDescription>From your recorded practice attempts.</CardDescription>
          </CardHeader>
          <CardContent>
            {!activity || activity.attempts === 0 ? (
              <p className="text-sm text-muted-foreground">No attempts recorded yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-lg font-semibold tabular-nums">{activity.attempts}</p>
                  <p className="text-xs text-muted-foreground">attempts</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-lg font-semibold tabular-nums">
                    {Math.round((activity.correct / activity.attempts) * 100)}%
                  </p>
                  <p className="text-xs text-muted-foreground">accuracy</p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2">
                  <p className="text-xs font-medium leading-tight">
                    {activity.last?.title ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {activity.last?.lastPracticedAt
                      ? formatRelative(activity.last.lastPracticedAt)
                      : "never"}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Predicted grade — honest not-implemented state */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-muted-foreground" aria-hidden="true" />
              Predicted grade
            </CardTitle>
            <CardDescription>Not implemented yet — by design.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <Compass className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                Grade prediction is a Cycle-1 research outcome (Paper B) and is not implemented
                yet. Nothing is shown here rather than an invented number — mastery,
                misconceptions and review scheduling above are the measured signals it will
                build on.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
