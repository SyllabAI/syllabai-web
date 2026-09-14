"use client";

/**
 * T-029 Teacher minimal surface (Master Spec §6.10/§15/§22): class list,
 * Smart Mark review queue, human-mark overrides, and the κ agreement gate.
 *
 * Everything here is a projection of backend read models — no business rules.
 * The backend enforces /api/v1/teacher/** (TEACHER/ADMIN); the UI role check
 * that gates this tab is an affordance, never authorization.
 *
 * Honesty rules carried over from the backend read models:
 * - smart-mark failures render their failure reason (e.g. PROVIDER_UNAVAILABLE),
 *   never a fabricated score;
 * - per-point decisions are only offered when a smart-mark breakdown exists
 *   (the κ pairing needs them);
 * - κ states are explicit: none recorded yet / not enough paired decisions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck,
  ClipboardList,
  Gauge,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { TeacherContentView } from "@/components/syllabai/TeacherContentView";
import { formatRelative, humanizeCode } from "@/lib/format";
import { ConceptGraphView } from "@/components/syllabai/ConceptGraphView";
import type {
  AnswerMarkingView,
  KappaEvaluationView,
  SmartMarkBreakdownItem,
  SmartMarkView,
  TeacherLearnerView,
} from "@/lib/types";

const QUEUE_STATES = [
  { value: "PENDING", label: "Pending" },
  { value: "SMART_MARKED", label: "Smart-marked" },
  { value: "HUMAN_MARKED", label: "Human-marked" },
  { value: "OVERRIDDEN", label: "Overridden" },
] as const;

const stateBadgeClass: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  SMART_MARKED: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  HUMAN_MARKED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  OVERRIDDEN: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
};

function is404(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function is409(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

export function TeacherReviewView() {
  // class list
  const [learners, setLearners] = useState<TeacherLearnerView[] | null>(null);
  const [learnersError, setLearnersError] = useState<string | null>(null);

  // marking queue
  const [queueState, setQueueState] = useState<string>("PENDING");
  const [queue, setQueue] = useState<AnswerMarkingView[] | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);

  // selected answer detail + actions
  const [detail, setDetail] = useState<AnswerMarkingView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // human mark form
  const [marksInput, setMarksInput] = useState("");
  const [comments, setComments] = useState("");
  const [pointDecisions, setPointDecisions] = useState<Record<string, number>>({});

  // V15: the teacher tab hosts two surfaces — the Cycle-1 marking review
  // queue and the curriculum concept graph (4CH1 seed + T-C11 settled layer)
  const [surface, setSurface] = useState<"marking" | "graph" | "content">("marking");

  // kappa gate
  const [kappa, setKappa] = useState<KappaEvaluationView | null>(null);
  const [kappaStatus, setKappaStatus] = useState<
    "none" | "conflict" | "ok" | "loading" | "error"
  >("loading");
  const [kappaError, setKappaError] = useState<string | null>(null);

  const loadLearners = useCallback(async () => {
    setLearnersError(null);
    try {
      setLearners(await api.teacherLearners());
    } catch (e) {
      setLearnersError(e instanceof ApiError ? e.message : "Could not load the class list.");
    }
  }, []);

  // Last-request-wins guards: rapid state-tab switches or answer clicks must
  // never let a slower older response overwrite the newer one (a human mark
  // recorded from a queue/detail that no longer matches the visible list is a
  // wrong-mark hazard, not a cosmetic glitch).
  const queueSeq = useRef(0);
  const detailSeq = useRef(0);

  const loadQueue = useCallback(async (state: string) => {
    const seq = ++queueSeq.current;
    setQueueLoading(true);
    setQueueError(null);
    try {
      const view = await api.markingQueue(state);
      if (seq !== queueSeq.current) return; // a newer state switch won
      setQueue(view);
    } catch (e) {
      if (seq !== queueSeq.current) return;
      setQueueError(e instanceof ApiError ? e.message : "Could not load the marking queue.");
    } finally {
      if (seq === queueSeq.current) setQueueLoading(false);
    }
  }, []);

  const loadKappa = useCallback(async () => {
    setKappaStatus("loading");
    setKappaError(null);
    try {
      setKappa(await api.kappaLatest());
      setKappaStatus("ok");
    } catch (e) {
      setKappa(null);
      if (is404(e)) {
        setKappaStatus("none");
      } else if (is409(e)) {
        setKappaStatus("conflict");
      } else {
        // honesty rule (file header): a 500 / network failure is NOT "none
        // recorded" — say so and surface the reason instead
        setKappaStatus("error");
        setKappaError(e instanceof ApiError ? e.message : "Could not reach the κ evaluation.");
      }
    }
  }, []);

  useEffect(() => {
    loadLearners();
    loadKappa();
  }, [loadLearners, loadKappa]);

  useEffect(() => {
    loadQueue(queueState);
    setDetail(null);
    setDetailError(null);
    setActionError(null);
    setActionNotice(null);
  }, [queueState, loadQueue]);

  const selectAnswer = useCallback(
    async (answerId: string) => {
      const seq = ++detailSeq.current;
      setDetailError(null);
      setActionError(null);
      setActionNotice(null);
      try {
        const view = await api.markingAnswer(answerId);
        if (seq !== detailSeq.current) return; // a newer selection won
        setDetail(view);
        setMarksInput(view.latestHumanMark ? String(view.latestHumanMark.marksAwarded) : "");
        setComments(view.latestHumanMark?.comments ?? "");
        // seed per-point decisions from the smart-mark breakdown so κ pairing
        // has something concrete to align against; teacher can flip each one
        const seeds: Record<string, number> = {};
        view.latestSmartMark?.breakdown?.forEach((b: SmartMarkBreakdownItem) => {
          if (b.markPointId) seeds[b.markPointId] = b.awarded ? 1 : 0;
        });
        setPointDecisions(seeds);
      } catch (e) {
        if (seq !== detailSeq.current) return;
        setDetail(null);
        setDetailError(e instanceof ApiError ? e.message : "Could not load the answer.");
      }
    },
    [],
  );

  const refreshDetailAndQueue = useCallback(
    async (answerId: string) => {
      await selectAnswer(answerId);
      await loadQueue(queueState);
      await loadKappa();
    },
    [selectAnswer, loadQueue, queueState, loadKappa],
  );

  const runSmartMark = useCallback(
    async (answerId: string) => {
      setActionBusy("smart");
      setActionError(null);
      setActionNotice(null);
      try {
        const result: SmartMarkView = await api.runSmartMark(answerId);
        if (result.validationPassed) {
          setActionNotice(
            `Smart Mark awarded ${result.marksAwarded} mark(s) — provisional until the κ gate passes.`,
          );
        } else {
          setActionError(
            `Smart Mark did not produce marks: ${humanizeCode(result.failureReason ?? "FAILED")}.`,
          );
        }
        await refreshDetailAndQueue(answerId);
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "Smart Mark could not run.");
      } finally {
        setActionBusy(null);
      }
    },
    [refreshDetailAndQueue],
  );

  const submitHumanMark = useCallback(
    async (answerId: string, partMarks: number) => {
      // Guard the blank field FIRST: Number("") is 0, so the old check let an
      // empty input through as a legitimate zero-mark submission.
      const raw = marksInput.trim();
      if (raw === "") {
        setActionError("Enter the marks awarded before submitting.");
        return;
      }
      const marks = Number(raw);
      if (!Number.isInteger(marks) || marks < 0 || marks > partMarks) {
        setActionError(`Marks must be a whole number between 0 and ${partMarks}.`);
        return;
      }
      setActionBusy("human");
      setActionError(null);
      setActionNotice(null);
      try {
        await api.recordHumanMark(answerId, {
          marksAwarded: marks,
          perPointDecisions: Object.keys(pointDecisions).length ? pointDecisions : null,
          comments: comments.trim() || null,
        });
        setActionNotice("Human mark recorded — it is now the authoritative grade.");
        await refreshDetailAndQueue(answerId);
      } catch (e) {
        setActionError(e instanceof ApiError ? e.message : "The mark could not be recorded.");
      } finally {
        setActionBusy(null);
      }
    },
    [marksInput, comments, pointDecisions, refreshDetailAndQueue],
  );

  const recomputeKappa = useCallback(async () => {
    setActionBusy("kappa");
    setActionError(null);
    setActionNotice(null);
    try {
      const evaluation = await api.evaluateKappa();
      setKappa(evaluation);
      setKappaStatus("ok");
      setActionNotice(
        `κ = ${evaluation.kappa.toFixed(2)} on ${evaluation.sampleSize} paired point decisions (gate ${evaluation.passed ? "PASSED" : "not passed"}, threshold ${evaluation.threshold.toFixed(2)}).`,
      );
    } catch (e) {
      if (is409(e)) {
        setActionError(
          "κ needs paired per-point decisions: record human marks with point decisions after a validated Smart Mark run.",
        );
      } else {
        setActionError(e instanceof ApiError ? e.message : "κ could not be evaluated.");
      }
    } finally {
      setActionBusy(null);
    }
  }, []);

  const smartBreakdownPoints = useMemo(() => {
    const points: { markPointId: string; awarded: boolean }[] = [];
    detail?.latestSmartMark?.breakdown?.forEach((b) => {
      if (b.markPointId) {
        points.push({ markPointId: b.markPointId, awarded: Boolean(b.awarded) });
      }
    });
    return points;
  }, [detail]);

  return (
    <div className="space-y-4">
      <Tabs value={surface} onValueChange={(v) => setSurface(v as "marking" | "graph" | "content")}>
        <TabsList className="grid h-auto w-full max-w-md grid-cols-3">
          <TabsTrigger value="marking" className="text-xs">
            Marking review
          </TabsTrigger>
          <TabsTrigger value="graph" className="text-xs">
            Curriculum graph
          </TabsTrigger>
          <TabsTrigger value="content" className="text-xs">
            Content gate
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {surface === "graph" ? (
        <ConceptGraphView />
      ) : surface === "content" ? (
        <TeacherContentView />
      ) : (
        <>
          <Alert>
          <ShieldCheck className="size-4" aria-hidden="true" />
          <AlertTitle>Teacher review surface (minimal, Cycle 1)</AlertTitle>
          <AlertDescription>
            The class list is the whole pilot cohort (classes are a Cycle-2+ concept). Human marks are
            the authoritative grade; Smart Mark results are provisional until the κ agreement gate
            passes. This surface presents facts only — no recommendations.
          </AlertDescription>
        </Alert>

      {/* ── Class list ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" aria-hidden="true" />
            Class list
            {learners && (
              <Badge variant="secondary" className="ml-1">
                {learners.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Every enabled learner account, ordered by name. Joined dates come from the identity
            store.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {learnersError ? (
            <p className="text-sm text-destructive">{learnersError}</p>
          ) : !learners ? (
            <Skeleton className="h-24 w-full" />
          ) : learners.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No learner accounts yet — learners appear here when they register.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Learner</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="hidden px-3 py-2 font-medium sm:table-cell">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {learners.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-3 py-2 font-medium">{l.displayName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{l.email}</td>
                      <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                        {formatRelative(l.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── κ agreement gate ───────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-primary" aria-hidden="true" />
            Smart Mark agreement gate (κ)
          </CardTitle>
          <CardDescription>
            Cohen&apos;s κ over paired per-point decisions between the newest accepted Smart Mark
            run and the newest human mark. Fail-closed: below threshold, Smart Mark stays
            provisional.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {kappaStatus === "loading" ? (
            <Skeleton className="h-9 w-64" />
          ) : kappa ? (
            <>
              <div className="flex items-center gap-2">
                <Badge className={kappa.passed ? "bg-emerald-600" : "bg-rose-600"}>
                  κ {kappa.kappa.toFixed(2)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {kappa.sampleSize} pairs · threshold {kappa.threshold.toFixed(2)} ·{" "}
                  {kappa.scope === "ALL" ? "all papers" : "one paper"} ·{" "}
                  {formatRelative(kappa.computedAt)}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={recomputeKappa}
                disabled={actionBusy === "kappa"}
              >
                <RotateCw className="size-4" aria-hidden="true" />
                Recompute
              </Button>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                {kappaStatus === "conflict"
                  ? "No paired smart/human point decisions available yet."
                  : kappaStatus === "error"
                    ? (kappaError ?? "Could not load the κ evaluation.")
                    : "No κ evaluation recorded yet."}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={recomputeKappa}
                disabled={actionBusy === "kappa"}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                Evaluate κ
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Marking review queue ───────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4 text-primary" aria-hidden="true" />
            Marking review queue
          </CardTitle>
          <CardDescription>
            Answers by marking state. Review the answer, compare against the mark scheme via Smart
            Mark, then record the authoritative human mark.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={queueState} onValueChange={setQueueState}>
            <TabsList className="grid h-auto w-full max-w-xl grid-cols-2 sm:grid-cols-4">
              {QUEUE_STATES.map((s) => (
                <TabsTrigger key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {queueError ? (
            <p className="text-sm text-destructive">{queueError}</p>
          ) : !queue || (queueLoading && !detail) ? (
            <Skeleton className="h-32 w-full" />
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No answers in this state right now. Learner submissions appear here as they practise.
            </p>
          ) : (
            <ul className="space-y-2" aria-live="polite">
              {queue.map((item) => (
                <li key={item.answerId}>
                  <button
                    type="button"
                    onClick={() => selectAnswer(item.answerId)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${
                      detail?.answerId === item.answerId ? "border-primary bg-muted/40" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          {item.learnerDisplayName ?? "Unknown learner"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {item.questionExternalRef ?? "question"} · part {item.partLabel} ·{" "}
                          {item.partMarks} mark{item.partMarks === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.marksAwarded != null && (
                          <span className="text-xs text-muted-foreground">
                            {item.marksAwarded}/{item.partMarks}
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            stateBadgeClass[item.markingState] ?? ""
                          }`}
                        >
                          {humanizeCode(item.markingState)}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {item.answerText || "(blank answer)"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {detailError && <p className="text-sm text-destructive">{detailError}</p>}

          {actionError && (
            <Alert variant="destructive">
              <AlertTitle>Could not complete</AlertTitle>
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}
          {actionNotice && (
            <Alert>
              <AlertTitle>Done</AlertTitle>
              <AlertDescription>{actionNotice}</AlertDescription>
            </Alert>
          )}

          {detail && (
            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {detail.learnerDisplayName ?? "Unknown learner"} — part {detail.partLabel}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {detail.questionExternalRef ?? "question"}
                    </span>
                  </h3>
                  <Badge variant="outline">{humanizeCode(detail.markingState)}</Badge>
                </div>
                <p className="mt-2 text-sm">{detail.partPrompt}</p>
                <div className="mt-2 rounded-md bg-muted/60 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Learner answer</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {detail.answerText || "(blank answer)"}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Latest Smart Mark (provisional)
                  </p>
                  {detail.latestSmartMark ? (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium">
                          {detail.latestSmartMark.marksAwarded}/{detail.partMarks}
                        </span>{" "}
                        {detail.latestSmartMark.confidence != null && (
                          <span className="text-muted-foreground">
                            · confidence {(detail.latestSmartMark.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {detail.latestSmartMark.validationPassed
                          ? `validated · ${detail.latestSmartMark.modelId ?? "unknown model"} · pipeline ${detail.latestSmartMark.pipelineVersion ?? "?"} · ${formatRelative(detail.latestSmartMark.createdAt)}`
                          : `failed: ${humanizeCode(detail.latestSmartMark.failureReason ?? "FAILED")} — never fabricated`}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No Smart Mark run yet.</p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runSmartMark(detail.answerId)}
                    disabled={actionBusy !== null}
                  >
                    <Sparkles className="size-4" aria-hidden="true" />
                    {actionBusy === "smart" ? "Running…" : "Run Smart Mark"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Latest human mark (authoritative)
                  </p>
                  {detail.latestHumanMark ? (
                    <div className="space-y-1 text-sm">
                      <p>
                        <span className="font-medium">
                          {detail.latestHumanMark.marksAwarded}/{detail.partMarks}
                        </span>
                      </p>
                      {detail.latestHumanMark.comments && (
                        <p className="text-xs text-muted-foreground">
                          “{detail.latestHumanMark.comments}”
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        recorded {formatRelative(detail.latestHumanMark.createdAt)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No human mark yet.</p>
                  )}
                </div>
              </div>

              {smartBreakdownPoints.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Mark-point decisions (for κ pairing)
                  </p>
                  <div className="space-y-1">
                    {smartBreakdownPoints.map((p) => (
                      <div
                        key={p.markPointId}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.markPointId.slice(0, 8)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            smart: {p.awarded ? "1" : "0"}
                          </span>
                          <Select
                            value={String(pointDecisions[p.markPointId] ?? (p.awarded ? 1 : 0))}
                            onValueChange={(v) =>
                              setPointDecisions((prev) => ({
                                ...prev,
                                [p.markPointId]: Number(v),
                              }))
                            }
                          >
                            <SelectTrigger className="h-7 w-28 text-xs" aria-label="Human decision">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="1">human: 1</SelectItem>
                              <SelectItem value="0">human: 0</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Seeded from the Smart Mark breakdown — adjust to your judgement; they drive the
                    κ calibration set.
                  </p>
                </div>
              )}

              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Record human mark (override)
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="marks" className="text-xs">
                      Marks (0–{detail.partMarks})
                    </Label>
                    <Input
                      id="marks"
                      inputMode="numeric"
                      className="h-8 w-24"
                      value={marksInput}
                      onChange={(e) => setMarksInput(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <div className="min-w-[200px] flex-1 space-y-1">
                    <Label htmlFor="comments" className="text-xs">
                      Comments (rationale)
                    </Label>
                    <Textarea
                      id="comments"
                      className="min-h-9"
                      rows={2}
                      value={comments}
                      onChange={(e) => setComments(e.target.value)}
                      placeholder="Why these marks…"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => submitHumanMark(detail.answerId, detail.partMarks)}
                    disabled={actionBusy !== null}
                  >
                    <ClipboardCheck className="size-4" aria-hidden="true" />
                    {actionBusy === "human" ? "Recording…" : "Record mark"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  First human mark fires the evidence contract once (BKT/fluency react); later
                  marks are overrides that never re-fire evidence.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  );
}
