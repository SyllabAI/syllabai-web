"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  Compass,
  GraduationCap,
  ListChecks,
  MessagesSquare,
  RefreshCw,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  LearnerKnowledgeGraphView,
  SmartLessonView,
} from "@/lib/types";

/**
 * Smart Lesson MVP (productization sprint §2): pick a topic, get ONE
 * explainable next action derived from your own evidence, act on it, come back
 * — the next recommendation reacts to what you just did. The decision is made
 * entirely by the deterministic backend ladder; this surface renders the
 * action, the honest topic status and the evidence trace it used.
 */
export function SmartLessonView({
  graph,
  rootId,
  subjectName,
  refreshKey,
  onPracticeTopic,
  onAskTutorAbout,
}: {
  graph: LearnerKnowledgeGraphView | null;
  rootId: string | null;
  subjectName: string | null;
  /** bumped by the app whenever new evidence lands (attempt submitted) — re-queries the lesson */
  refreshKey: number;
  onPracticeTopic: (nodeId: string, title: string) => void;
  onAskTutorAbout: (draft: string) => void;
}) {
  const [topicNodeId, setTopicNodeId] = useState<string | null>(null);
  const [lesson, setLesson] = useState<SmartLessonView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** TOPIC + SUBTOPIC nodes (same practicable scope as NBA T7 / practice) */
  const topics = useMemo(() => {
    if (!graph) return [];
    return graph.nodes
      .filter((n) => n.type === "TOPIC" || n.type === "SUBTOPIC")
      .sort((a, b) => (a.code ?? "").localeCompare(b.code ?? ""));
  }, [graph]);

  useEffect(() => {
    setTopicNodeId(null);
    setLesson(null);
    setError(null);
  }, [rootId]);

  const fetchLesson = useCallback(
    async (nodeId: string) => {
      if (!rootId) return;
      setLoading(true);
      setError(null);
      try {
        const next = await api.smartLesson(rootId, nodeId);
        setLesson(next);
      } catch (err) {
        setLesson(null);
        setError(err instanceof Error ? err.message : "Failed to load the smart lesson");
      } finally {
        setLoading(false);
      }
    },
    [rootId],
  );

  const selectTopic = useCallback(
    (nodeId: string) => {
      setTopicNodeId(nodeId);
      fetchLesson(nodeId);
    },
    [fetchLesson],
  );

  // the closed loop: new evidence (attempt submitted / tutor ask) bumps the
  // refresh key and the lesson re-queries for the selected topic
  useEffect(() => {
    if (topicNodeId && refreshKey > 0) {
      fetchLesson(topicNodeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const action = lesson?.action;
  const isTutorAction = action?.actionType === "ASK_TUTOR";

  const start = useCallback(() => {
    if (!action) return;
    if (isTutorAction) {
      onAskTutorAbout(
        `I might be confusing something in ${lesson?.topicCode ?? "this topic"} — can you explain ${action.targetTitle ?? "the idea"} with an example?`,
      );
    } else {
      onPracticeTopic(action.targetNodeId, action.targetTitle ?? action.targetCode ?? "topic");
    }
  }, [action, isTutorAction, lesson?.topicCode, onPracticeTopic, onAskTutorAbout]);

  const actionIcon = useMemo(() => {
    switch (action?.actionType) {
      case "REMEDIATE_PREREQUISITE":
        return <TriangleAlert className="size-5" aria-hidden="true" />;
      case "STUDY_CORRECTIVE":
        return <BookOpenCheck className="size-5" aria-hidden="true" />;
      case "ASK_TUTOR":
        return <MessagesSquare className="size-5" aria-hidden="true" />;
      case "REVIEW_TOPIC":
        return <Brain className="size-5" aria-hidden="true" />;
      case "TIMED_PRACTICE":
        return <Timer className="size-5" aria-hidden="true" />;
      case "ADVANCE_TOPIC":
        return <ArrowRight className="size-5" aria-hidden="true" />;
      default:
        return <ListChecks className="size-5" aria-hidden="true" />;
    }
  }, [action?.actionType]);

  const fmt = (v: number | null | undefined) =>
    v == null ? "—" : `${Math.round(v * 100)}%`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Compass className="size-5" aria-hidden="true" />
            Smart lesson
          </CardTitle>
          <CardDescription>
            Pick a topic{subjectName ? ` in ${subjectName}` : ""} — SyllabAI works out the
            single best next step from your own evidence, tells you why, and adapts after
            you act.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label
                htmlFor="smart-lesson-topic"
                className="mb-1 block text-sm font-medium"
              >
                Topic / specification area
              </label>
              <select
                id="smart-lesson-topic"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={topicNodeId ?? ""}
                onChange={(e) => e.target.value && selectTopic(e.target.value)}
                disabled={!graph || topics.length === 0}
              >
                <option value="" disabled>
                  {topics.length === 0
                    ? "No topics with validated practice yet"
                    : "Choose a topic…"}
                </option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code ? `${t.code} — ${t.title}` : t.title}
                  </option>
                ))}
              </select>
            </div>
            {topicNodeId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchLesson(topicNodeId)}
                disabled={loading}
              >
                <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
                What&apos;s next?
              </Button>
            )}
          </div>

          {!graph && (
            <p className="text-sm text-muted-foreground">
              The curriculum map is still loading — the topic picker appears in a moment.
            </p>
          )}
        </CardContent>
      </Card>

      {loading && !lesson && <Skeleton className="h-56 w-full" />}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load the lesson</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {lesson && action && (
        <>
          <Card className="border-primary/40">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {actionIcon}
                  Your next step
                  <Badge variant="secondary">{action.reasonCode.replace(/_/g, " ").toLowerCase()}</Badge>
                </CardTitle>
                {action.targetNodeId !== lesson.topicNodeId && (
                  <Badge variant="outline" className="text-xs">
                    redirected to {action.targetCode ?? "related topic"}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-sm leading-relaxed text-foreground">
                {action.reasonDetail}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {action.targetTitle ?? action.targetCode}
                </span>
                <span>·</span>
                <span>
                  {action.servableQuestionCount} validated question
                  {action.servableQuestionCount === 1 ? "" : "s"} available
                </span>
              </div>
              <Button onClick={start} size="lg" className="gap-2">
                {isTutorAction ? (
                  <>
                    <MessagesSquare className="size-4" aria-hidden="true" />
                    Ask the Tutor
                  </>
                ) : (
                  <>
                    <GraduationCap className="size-4" aria-hidden="true" />
                    Start practising
                  </>
                )}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              {action.targetNodeId !== lesson.topicNodeId && (
                <p className="text-xs text-muted-foreground">
                  You selected {lesson.topicCode ?? "this topic"} — the lesson starts one
                  step earlier because of your evidence. Finish this and come back.
                </p>
              )}
            </CardContent>
          </Card>

          {(lesson.prerequisites.length > 0 || lesson.misconceptions.length > 0) && (
            <div className="grid gap-4 md:grid-cols-2">
              {lesson.prerequisites.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Prerequisites of {lesson.topicCode ?? "this topic"}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Your measured mastery is the overlay — unmeasured is an honest gap,
                      never a guess.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {lesson.prerequisites.map((pr) => (
                        <li
                          key={pr.nodeId}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            className="text-left font-medium underline-offset-2 hover:underline"
                            onClick={() => selectTopic(pr.nodeId)}
                          >
                            {pr.code ? `${pr.code} — ${pr.title}` : pr.title}
                          </button>
                          {pr.measuredWeak ? (
                            <Badge variant="destructive">weak · {fmt(pr.effectiveMastery)}</Badge>
                          ) : pr.effectiveMastery != null ? (
                            <Badge variant="secondary">strong · {fmt(pr.effectiveMastery)}</Badge>
                          ) : (
                            <Badge variant="outline">not yet measured</Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              {lesson.misconceptions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Known misconceptions in this area</CardTitle>
                    <CardDescription className="text-xs">
                      Validated KG entries; your probability lights up from your own answers.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {lesson.misconceptions.map((m) => (
                        <li
                          key={m.nodeId}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span className="font-medium">{m.title}</span>
                          {m.active ? (
                            <Badge variant="destructive">
                              active · {fmt(m.probability)}
                            </Badge>
                          ) : m.probability != null ? (
                            <Badge variant="secondary">{fmt(m.probability)}</Badge>
                          ) : (
                            <Badge variant="outline">not yet seen</Badge>
                          )}
                          {m.remediationNodeCode && (
                            <span className="text-xs text-muted-foreground">
                              fix: study {m.remediationNodeCode}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Where you stand on {lesson.topicCode ?? "this topic"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-1.5 text-sm">
                  <Row label="Coverage" value={lesson.topicStatus.coverage.toLowerCase()} />
                  <Row label="Attempts" value={String(lesson.topicStatus.attempts)} />
                  <Row
                    label="Mastery (decay-adjusted)"
                    value={fmt(lesson.topicStatus.effectiveMastery ?? lesson.topicStatus.mastery)}
                  />
                  <Row
                    label="Review due"
                    value={lesson.topicStatus.reviewDue ? "yes" : "no"}
                  />
                  <Row
                    label="Misconception signal"
                    value={fmt(lesson.topicStatus.strongestMisconceptionProbability)}
                  />
                  <Row label="Tutor asks (14d)" value={String(lesson.topicStatus.tutorAsks)} />
                  <Row
                    label="Validated questions"
                    value={String(lesson.topicStatus.servableQuestions)}
                  />
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Why this step — the evidence used</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {lesson.evidence.map((fact) => (
                    <li key={fact.key} className="flex flex-wrap gap-x-2">
                      <span className="font-medium">{fact.key}:</span>
                      <span className="text-muted-foreground">{fact.value}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
