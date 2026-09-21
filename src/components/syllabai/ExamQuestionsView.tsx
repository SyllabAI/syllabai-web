"use client";

/**
 * Exam Questions (session-112, ADR-026): the topic/subtopic browser over the
 * full servable SME corpus — demo parity for browsing, plus the answering
 * loop the demo never had.
 *
 * Marking model (operator-specified):
 * - MCQs are deterministically marked server-side (auto-graded attempts).
 * - STRUCTURED questions: "Send" submits the attempt and reveals the mark
 *   scheme (post-attempt, demo-style free reveal) with the SME self-mark flow
 *   under it; the separate "Smart Mark" button submits and AI-marks WITHOUT
 *   revealing the scheme — Feedback ("Explain my feedback") and "Improve my
 *   answer" only, so the official scheme stays hidden while the student still
 *   gets marked feedback. After Smart Mark the reveal stays available (the
 *   attempt exists), closing the loop into self-marking.
 * - Every submit flows through the same attempt endpoints as Practice, so the
 *   learner model (BKT fan-out, evidence, telemetry, decay anchors) updates
 *   identically — the integration is the reuse.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Eye,
  Loader2,
  MessagesSquare,
  PenLine,
  RotateCcw,
  ScrollText,
  Send,
  Sparkles,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  AttemptHistoryView,
  AttemptResultView,
  LearnerKnowledgeGraphView,
  LearnerNodeWithStateView,
  MarkSchemeRevealView,
  QuestionTaxonomyTopic,
  QuestionTopicTaxonomyView,
  SelfMarkView,
  StudentQuestionView,
  StructuredAttemptResultView,
} from "@/lib/types";
import { MarksStepper } from "./MarksStepper";
import { QuestionHelpPanel } from "./QuestionHelpPanel";
import { QuestionMarkdown } from "./QuestionMarkdown";
import { SmartMarkPanel } from "./SmartMarkPanel";

const CONFIDENCE_LABELS = ["", "guessing", "unsure", "getting there", "confident", "certain"];
const PAGE_SIZE = 8;

const bandDot: Record<string, string> = {
  LOW: "bg-rose-500",
  DEVELOPING: "bg-amber-500",
  SECURE: "bg-emerald-500",
};

export function ExamQuestionsView({
  rootId,
  graph,
  history,
  onAttemptSubmitted,
  onAskTutorAbout,
}: {
  /** the subject's KG root — scopes the taxonomy and the question lists */
  rootId: string | null;
  /** the personalized graph already loaded by the workbench — mastery tint */
  graph: LearnerKnowledgeGraphView | null;
  /** recent attempts (already loaded) — the "tried" affordance on cards */
  history: AttemptHistoryView | null;
  onAttemptSubmitted: () => void;
  onAskTutorAbout?: (draft: string) => void;
}) {
  const [taxonomy, setTaxonomy] = useState<QuestionTopicTaxonomyView | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [selected, setSelected] = useState<QuestionTaxonomyTopic | null>(null);
  const [questions, setQuestions] = useState<StudentQuestionView[] | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  // node id -> this learner's mastery state (the sidebar tint)
  const masteryByNode = useMemo(() => {
    const map = new Map<string, LearnerNodeWithStateView>();
    for (const node of graph?.nodes ?? []) {
      map.set(node.id, node);
    }
    return map;
  }, [graph]);

  const attemptedQuestionIds = useMemo(
    () => new Set((history?.attempts ?? []).map((a) => a.questionId)),
    [history],
  );

  useEffect(() => {
    let cancelled = false;
    setTaxonomy(null);
    setTaxonomyError(null);
    setSelected(null);
    setQuestions(null);
    (async () => {
      try {
        const view = await api.questionTaxonomy(rootId ?? undefined);
        if (!cancelled) {
          setTaxonomy(view);
          // demo parity: land on the first topic rather than an empty pane
          setSelected(view.sections.flatMap((s) => s.topics)[0] ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setTaxonomyError(
            err instanceof Error ? err.message : "Failed to load the question topics",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  useEffect(() => {
    if (!selected) {
      setQuestions(null);
      return;
    }
    let cancelled = false;
    setQuestions(null);
    setQuestionsError(null);
    setVisible(PAGE_SIZE);
    (async () => {
      try {
        const list = await api.questions(selected.nodeId);
        if (!cancelled) setQuestions(list);
      } catch (err) {
        if (!cancelled) {
          setQuestionsError(
            err instanceof Error ? err.message : "Failed to load the questions",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (taxonomyError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Exam questions unavailable</AlertTitle>
        <AlertDescription>{taxonomyError}</AlertDescription>
      </Alert>
    );
  }

  if (!taxonomy) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const allTopics = taxonomy.sections.flatMap((s) => s.topics);
  if (allTopics.length === 0) {
    return (
      <Alert>
        <AlertTitle>No validated questions yet</AlertTitle>
        <AlertDescription>
          Questions appear here once validated content covers a topic — the same
          serving gate every learner surface uses.
        </AlertDescription>
      </Alert>
    );
  }

  const shown = questions?.slice(0, visible) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <ScrollText className="size-5 text-primary" aria-hidden="true" />
          Exam Questions
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every question in the corpus by topic — answer inline, reveal the mark
          scheme, self-mark, or let Smart Mark give you feedback without giving
          the scheme away.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[270px_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
            <p className="text-sm font-semibold tabular-nums">
              {taxonomy.totalDistinctQuestions}{" "}
              <span className="font-normal text-muted-foreground">questions</span>
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              across {allTopics.length} topics — a question testing several topics
              appears under each topic; this total counts each question once.
            </p>
          </div>
          {taxonomy.sections.map((section) => (
            <div key={section.nodeId} className="rounded-lg border bg-background">
              <p className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="min-w-0 truncate">{section.title}</span>
                <span
                  className="shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium normal-case tabular-nums text-muted-foreground"
                  title={`${section.distinctQuestionCount} distinct questions in this section (a question mapped to several of its topics counts once)`}
                >
                  {section.distinctQuestionCount}
                </span>
              </p>
              <ul className="p-1.5">
                {section.topics.map((topic) => {
                  const isActive = selected?.nodeId === topic.nodeId;
                  const node = masteryByNode.get(topic.nodeId);
                  return (
                    <li key={topic.nodeId}>
                      <button
                        type="button"
                        onClick={() => setSelected(topic)}
                        aria-current={isActive ? "true" : undefined}
                        className={[
                          "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                          isActive
                            ? "bg-primary/10 font-medium text-primary ring-1 ring-primary/30"
                            : "hover:bg-muted/60",
                        ].join(" ")}
                      >
                        {node?.band ? (
                          <span
                            className={`size-2 shrink-0 rounded-full ${bandDot[node.band] ?? "bg-muted-foreground/40"}`}
                            title={`Mastery ${Math.round((node.effectiveMastery ?? 0) * 100)}% (${node.band.toLowerCase()})`}
                            aria-label={`Mastery ${Math.round((node.effectiveMastery ?? 0) * 100)} percent`}
                          />
                        ) : (
                          <span
                            className="size-2 shrink-0 rounded-full bg-muted-foreground/25"
                            title="Not practised yet"
                            aria-label="Not practised yet"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{topic.title}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {topic.code}
                          </span>
                        </span>
                        <span className="shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                          {topic.questionCount}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </aside>

        <div className="min-w-0 space-y-4">
          {selected && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{selected.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {selected.code} · {selected.questionCount} questions ({selected.mcqCount}{" "}
                  multiple choice · {selected.structuredCount} structured) — a question
                  appears under every topic it tests
                </p>
              </div>
            </div>
          )}

          {questionsError && (
            <Alert variant="destructive">
              <AlertDescription>{questionsError}</AlertDescription>
            </Alert>
          )}

          {!questions && !questionsError && (
            <div className="space-y-4">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          )}

          {questions && questions.length === 0 && (
            <Alert>
              <AlertTitle>No questions on this topic</AlertTitle>
              <AlertDescription>
                No validated questions are linked to this topic yet.
              </AlertDescription>
            </Alert>
          )}

          {shown?.map((question, i) => (
            <ExamQuestionCard
              key={question.id}
              question={question}
              index={i}
              attempted={attemptedQuestionIds.has(question.id)}
              onAttemptSubmitted={onAttemptSubmitted}
              onAskTutorAbout={onAskTutorAbout}
            />
          ))}

          {questions && visible < questions.length && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setVisible((v) => v + PAGE_SIZE)}
            >
              <ChevronDown className="size-4" aria-hidden="true" />
              Show {Math.min(PAGE_SIZE, questions.length - visible)} more of{" "}
              {questions.length}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── one question card: header + stem + help + the marking-model answer flow ──

function ExamQuestionCard({
  question,
  index,
  attempted,
  onAttemptSubmitted,
  onAskTutorAbout,
}: {
  question: StudentQuestionView;
  index: number;
  attempted: boolean;
  onAttemptSubmitted: () => void;
  onAskTutorAbout?: (draft: string) => void;
}) {
  const [confidence, setConfidence] = useState(3);
  // responseTimeMs research anchor: the first interaction with THIS card, not
  // the topic load (browsing time between cards must not pollute response time)
  const startedAt = useRef<number | null>(null);
  const anchor = useCallback(() => {
    if (startedAt.current === null) startedAt.current = Date.now();
  }, []);
  const elapsed = () =>
    startedAt.current === null ? 0 : Date.now() - startedAt.current;

  const [chosen, setChosen] = useState<string | null>(null);
  const [mcqResult, setMcqResult] = useState<AttemptResultView | null>(null);
  const [partAnswers, setPartAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the structured flow's phase: which post-submit path owns the card
  const [attempt, setAttempt] = useState<StructuredAttemptResultView | null>(null);
  const [mode, setMode] = useState<"reveal" | "smart" | null>(null);

  const isStructured = question.type === "STRUCTURED";
  const parts = question.parts ?? [];
  const allAnswered = isStructured
    ? parts.every((part) => (partAnswers[part.id] ?? "").trim().length > 0)
    : Boolean(chosen);

  function reset() {
    setChosen(null);
    setMcqResult(null);
    setPartAnswers({});
    setAttempt(null);
    setMode(null);
    setError(null);
    setConfidence(3);
    startedAt.current = null;
  }

  async function submitMcq() {
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.submitAttempt({
        questionId: question.id,
        chosenOptionId: chosen,
        responseTimeMs: elapsed(),
        confidence,
        selfDoubtFlag: false,
        timedCondition: false,
      });
      setMcqResult(result);
      onAttemptSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit the attempt");
    } finally {
      setBusy(false);
    }
  }

  async function submitStructured(): Promise<StructuredAttemptResultView | null> {
    if (!allAnswered || busy) return null;
    setBusy(true);
    setError(null);
    try {
      const response = await api.submitStructuredAttempt({
        questionId: question.id,
        partAnswers: parts.map((part) => ({
          partId: part.id,
          answerText: partAnswers[part.id] ?? "",
        })),
        responseTimeMs: elapsed(),
        confidence,
        selfDoubtFlag: false,
        timedCondition: false,
      });
      setAttempt(response);
      onAttemptSubmitted();
      return response;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit the attempt");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">Q{index + 1}</span>
          {question.commandWord ? (
            <Badge variant="outline" className="capitalize">
              {question.commandWord}
            </Badge>
          ) : null}
          <Badge variant="secondary">
            {question.marks} mark{question.marks === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline">difficulty {question.difficulty}/5</Badge>
          <Badge variant="outline">
            <Clock className="mr-1 size-3" aria-hidden="true" />~{question.expectedTimeSeconds}s
          </Badge>
          {isStructured ? (
            <Badge variant="outline" className="gap-1">
              <PenLine className="size-3" aria-hidden="true" /> structured
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1">
              <ClipboardCheck className="size-3" aria-hidden="true" /> multiple choice
            </Badge>
          )}
          {attempted && (
            <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3" aria-hidden="true" /> tried before
            </Badge>
          )}
          {question.externalRef ? (
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {question.externalRef}
            </span>
          ) : null}
        </div>
        {(question.specPointCodes ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(question.specPointCodes ?? []).slice(0, 4).map((code) => (
              <Badge key={code} variant="secondary" className="font-mono text-[10px]">
                {code}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {question.stem ? <QuestionMarkdown>{question.stem}</QuestionMarkdown> : null}
        <QuestionHelpPanel question={question} />

        {isStructured ? (
          mode === null || attempt === null ? (
            <StructuredAnswerInputs
              question={question}
              partAnswers={partAnswers}
              setPartAnswers={setPartAnswers}
              confidence={confidence}
              setConfidence={setConfidence}
              disabled={busy}
              onFirstTouch={anchor}
              busy={busy}
              allAnswered={allAnswered}
              error={error}
              onSend={async () => {
                const response = await submitStructured();
                if (response) setMode("reveal");
              }}
              onSmartMark={async () => {
                const response = await submitStructured();
                if (response) setMode("smart");
              }}
            />
          ) : mode === "smart" ? (
            <div className="space-y-4">
              <SmartMarkPanel
                question={question}
                attemptId={attempt.attemptId}
                marksPossible={attempt.marksPossible}
                partAnswers={partAnswers}
                autoRun
              />
              <p className="text-[11px] text-muted-foreground">
                The mark scheme stays hidden while you work with Smart Mark —
                you&apos;ve attempted the question, so you can still reveal it and
                self-mark when you&apos;re ready.
              </p>
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => setMode("reveal")}
              >
                <Eye className="size-4" aria-hidden="true" />
                Reveal mark scheme &amp; self-mark
              </Button>
            </div>
          ) : (
            <StructuredRevealFlow
              question={question}
              attempt={attempt}
              partAnswers={partAnswers}
              onDone={reset}
            />
          )
        ) : mcqResult ? (
          <McqResult
            question={question}
            result={mcqResult}
            chosen={chosen}
            onAskTutorAbout={onAskTutorAbout}
            onRetry={reset}
          />
        ) : (
          <McqAnswerInputs
            question={question}
            chosen={chosen}
            setChosen={setChosen}
            confidence={confidence}
            setConfidence={setConfidence}
            disabled={busy}
            onFirstTouch={anchor}
            busy={busy}
            allAnswered={allAnswered}
            error={error}
            onSubmit={submitMcq}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── shared compact confidence row (calibration data keeps flowing here) ─────

function ConfidenceRow({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <Label className="shrink-0 text-xs text-muted-foreground">Confidence</Label>
      <Slider
        min={1}
        max={5}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        disabled={disabled}
        className="max-w-40"
        aria-label="Confidence"
      />
      <span className="text-[11px] text-muted-foreground">{CONFIDENCE_LABELS[value]}</span>
    </div>
  );
}

// ── MCQ answering ───────────────────────────────────────────────────────────

function McqAnswerInputs({
  question,
  chosen,
  setChosen,
  confidence,
  setConfidence,
  disabled,
  onFirstTouch,
  busy,
  allAnswered,
  error,
  onSubmit,
}: {
  question: StudentQuestionView;
  chosen: string | null;
  setChosen: (id: string) => void;
  confidence: number;
  setConfidence: (v: number) => void;
  disabled?: boolean;
  onFirstTouch: () => void;
  busy: boolean;
  allAnswered: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Answer options">
        {(question.options ?? []).map((option) => {
          const isSelected = chosen === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => {
                onFirstTouch();
                setChosen(option.id);
              }}
              className={[
                "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                "hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "",
                disabled ? "opacity-60" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border font-semibold text-sm",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-muted",
                ].join(" ")}
              >
                {option.label}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-relaxed">
                <QuestionMarkdown>{option.text}</QuestionMarkdown>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConfidenceRow value={confidence} onChange={setConfidence} disabled={busy} />
        <Button onClick={onSubmit} disabled={!allAnswered || busy}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          Submit answer
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function McqResult({
  question,
  result,
  chosen,
  onAskTutorAbout,
  onRetry,
}: {
  question: StudentQuestionView;
  result: AttemptResultView;
  chosen: string | null;
  onAskTutorAbout?: (draft: string) => void;
  onRetry: () => void;
}) {
  const [scheme, setScheme] = useState<MarkSchemeRevealView | null>(null);

  // post-attempt: the worked solution (the MCQ's mark scheme) reveals freely,
  // exactly like the demo — the attempt has already been deterministically marked
  useEffect(() => {
    let cancelled = false;
    api
      .markScheme(question.id)
      .then((s) => {
        if (!cancelled) setScheme(s ?? null);
      })
      .catch(() => {
        /* the verdict stands without the worked solution */
      });
    return () => {
      cancelled = true;
    };
  }, [question.id]);

  const correctOptionId =
    question.options.find((o) => o.label === result.correctOptionLabel)?.id ?? null;

  return (
    <div className="space-y-4">
      <Alert variant={result.correct ? "default" : "destructive"}>
        {result.correct ? (
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
        ) : (
          <XCircle className="size-4" aria-hidden="true" />
        )}
        <AlertTitle>
          {result.correct
            ? `Correct — ${result.marksAwarded}/${result.marksTotal} marks`
            : `Not correct — ${result.marksAwarded}/${result.marksTotal} marks`}
        </AlertTitle>
        <AlertDescription>
          {result.correct
            ? "Marked automatically. Your mastery estimate for this topic has been updated."
            : `Marked automatically — the correct answer is ${result.correctOptionLabel}. Your mastery estimate was updated.`}
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 sm:grid-cols-2" aria-label="Your answer and the correct answer">
        {(question.options ?? []).map((option) => {
          const isSelected = chosen === option.id;
          const isCorrect = correctOptionId === option.id;
          const isWrongPick = isSelected && !isCorrect;
          return (
            <div
              key={option.id}
              className={[
                "flex items-start gap-3 rounded-lg border p-3 text-left",
                isCorrect ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40" : "",
                isWrongPick ? "border-destructive bg-destructive/10" : "",
                !isCorrect && !isWrongPick ? "opacity-70" : "",
              ].join(" ")}
            >
              <span
                className={[
                  "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border font-semibold text-sm",
                  isCorrect ? "border-emerald-500 bg-emerald-500 text-white" : "bg-muted",
                  isWrongPick
                    ? "border-destructive bg-destructive text-destructive-foreground"
                    : "",
                ].join(" ")}
              >
                {option.label}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-relaxed">
                <QuestionMarkdown>{option.text}</QuestionMarkdown>
              </span>
              {isCorrect && (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
              )}
              {isWrongPick && (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>

      {scheme && (scheme.generalPoints.length > 0 || scheme.parts.length > 0) && (
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <PenLine className="size-4" aria-hidden="true" /> Worked solution
          </p>
          <div className="space-y-2">
            {scheme.generalPoints.map((p, i) => (
              <QuestionMarkdown key={`${p.ref ?? "pt"}-${i}`}>{p.text}</QuestionMarkdown>
            ))}
            {scheme.parts.flatMap((part) =>
              part.points.map((p, i) => (
                <QuestionMarkdown key={`${part.partId}-${p.ref ?? i}`}>{p.text}</QuestionMarkdown>
              )),
            )}
          </div>
        </div>
      )}

      {!result.correct && result.implicatedMisconceptionIds.length > 0 && (
        <Alert>
          <TriangleAlert className="size-4 text-amber-500" aria-hidden="true" />
          <AlertTitle>Misconception signal detected</AlertTitle>
          <AlertDescription>
            The option you chose matches a documented misconception — the BDT
            engine raised its probability.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
        {onAskTutorAbout && (
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              const stem = question.stem.slice(0, 300);
              const chosenLabel =
                question.options.find((o) => o.id === chosen)?.label ?? "";
              // the tutor only sees this text — without the option texts it has
              // to guess what A/B/C/D were (session-114 fix)
              const optionsFragment =
                question.options.length > 0
                  ? ` The options were: ${question.options
                      .map((o) => `${o.label}) ${o.text}`)
                      .join("  ")}.`
                  : "";
              onAskTutorAbout(
                result.correct
                  ? `I answered this exam question correctly: "${stem}" — I chose ${chosenLabel}.${optionsFragment} Can you explain the chemistry behind it?`
                  : `I got this exam question wrong and I don't understand why. The question was: "${stem}" — I chose ${chosenLabel} but the correct answer was ${result.correctOptionLabel}.${optionsFragment} Can you explain the chemistry behind the correct answer?`,
              );
            }}
          >
            <MessagesSquare className="size-4" aria-hidden="true" />
            Ask tutor about this
          </Button>
        )}
      </div>
    </div>
  );
}

// ── structured answering: the Send / Smart Mark fork ───────────────────────

function StructuredAnswerInputs({
  question,
  partAnswers,
  setPartAnswers,
  confidence,
  setConfidence,
  disabled,
  onFirstTouch,
  busy,
  allAnswered,
  error,
  onSend,
  onSmartMark,
}: {
  question: StudentQuestionView;
  partAnswers: Record<string, string>;
  setPartAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  confidence: number;
  setConfidence: (v: number) => void;
  disabled?: boolean;
  onFirstTouch: () => void;
  busy: boolean;
  allAnswered: boolean;
  error: string | null;
  onSend: () => void;
  onSmartMark: () => void;
}) {
  return (
    <div className="space-y-4">
      {(question.parts ?? []).map((part) => (
        <div key={part.id} className="space-y-1.5">
          <div className="text-sm font-semibold">
            <span className="mr-1.5 inline-flex size-6 items-center justify-center rounded border bg-muted font-mono text-xs">
              {part.label}
            </span>
            {part.commandWord ? `${part.commandWord} — ` : ""}
            <span className="ml-1 font-normal text-muted-foreground">
              ({part.marks} mark{part.marks > 1 ? "s" : ""})
            </span>
          </div>
          <QuestionMarkdown>{part.prompt}</QuestionMarkdown>
          <Textarea
            id={part.id}
            value={partAnswers[part.id] ?? ""}
            onFocus={onFirstTouch}
            onChange={(e) => {
              onFirstTouch();
              setPartAnswers((prev) => ({ ...prev, [part.id]: e.target.value }));
            }}
            placeholder="Write your answer…"
            rows={3}
            disabled={disabled}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
        <ConfidenceRow value={confidence} onChange={setConfidence} disabled={busy} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSend} disabled={!allAnswered || busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Send — show mark scheme
          </Button>
          <Button
            variant="outline"
            onClick={onSmartMark}
            disabled={!allAnswered || busy}
            title="AI-marks your answers with feedback, without revealing the mark scheme"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Smart Mark
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Send reveals the official mark scheme for self-marking (Save-My-Exams
        style). Smart Mark marks your answers point by point and explains the
        feedback — the scheme stays hidden, so you can still think for yourself.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ── the reveal-and-self-mark flow (demo style, post-attempt) ───────────────

function StructuredRevealFlow({
  question,
  attempt,
  partAnswers,
  onDone,
}: {
  question: StudentQuestionView;
  attempt: StructuredAttemptResultView;
  partAnswers: Record<string, string>;
  onDone: () => void;
}) {
  const [scheme, setScheme] = useState<MarkSchemeRevealView | null>(null);
  const [schemeState, setSchemeState] = useState<"loading" | "open" | "withheld" | "error">(
    "loading",
  );
  const [selfMarks, setSelfMarks] = useState<Record<string, number>>({});
  const [selfMarkResult, setSelfMarkResult] = useState<SelfMarkView | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const parts = question.parts ?? [];
  const allSelfMarked =
    parts.length > 0 && parts.every((p) => typeof selfMarks[p.id] === "number");
  const selfTotal = parts.reduce((sum, p) => sum + (selfMarks[p.id] ?? 0), 0);

  // the attempt exists: the scheme reveals (post-attempt, demo-style free reveal)
  useEffect(() => {
    let cancelled = false;
    setSchemeState("loading");
    api
      .markScheme(question.id)
      .then((s) => {
        if (!cancelled) {
          if (s) {
            setScheme(s);
            setSchemeState("open");
          } else {
            setSchemeState("withheld");
          }
        }
      })
      .catch(() => {
        if (!cancelled) setSchemeState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [question.id]);

  async function recordSelfMarks() {
    if (!allSelfMarked || !attempt.attemptId) return;
    setRecording(true);
    setRecordError(null);
    try {
      const view = await api.selfMarkAttempt(
        attempt.attemptId,
        parts.map((p) => ({ partId: p.id, marksAwarded: selfMarks[p.id] ?? 0 })),
      );
      setSelfMarkResult(view);
    } catch (err) {
      setRecordError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Failed to record the self-mark",
      );
    } finally {
      setRecording(false);
    }
  }

  if (selfMarkResult) {
    return (
      <div className="space-y-4">
        <Alert>
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
          <AlertTitle>
            Self-marked — {selfMarkResult.marksAwarded}/{selfMarkResult.marksTotal} marks
          </AlertTitle>
          <AlertDescription>
            Recorded and your mastery estimate has been updated
            {selfMarkResult.evidenceFired ? " (evidence fired)" : ""}. Your teacher can
            still review and override it — self-marks never enter the teacher κ
            calibration sample.
          </AlertDescription>
        </Alert>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {selfMarkResult.parts.map((part) => (
            <li key={part.partId} className="flex items-center justify-between gap-2">
              <span>Part {part.label}</span>
              <span className="text-xs">
                {part.marksAwarded}/{part.marksPossible} marks (self-assessed)
              </span>
            </li>
          ))}
        </ul>
        <Button variant="outline" onClick={onDone}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Send className="size-4 text-blue-600" aria-hidden="true" />
        <AlertTitle>Submitted — {attempt.marksPossible} marks</AlertTitle>
        <AlertDescription>
          Your written answers are stored. Mark yourself against the scheme below —
          tick what you earned — or leave it for your teacher.
        </AlertDescription>
      </Alert>

      {schemeState === "loading" && <Skeleton className="h-24 w-full" />}

      {schemeState === "withheld" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          The mark scheme isn&apos;t open for self-marking yet (awaiting teacher
          validation). Your answers stay in the teacher marking queue.
        </p>
      )}

      {schemeState === "error" && (
        <p className="text-sm text-destructive">
          The mark scheme couldn&apos;t be loaded — your answers stay in the teacher
          marking queue.
        </p>
      )}

      {schemeState === "open" && scheme && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <PenLine className="size-4" aria-hidden="true" /> Mark scheme — tick what you
              earned
            </p>
            <div className="space-y-4">
              {parts.map((part) => {
                const schemePart = scheme.parts.find((sp) => sp.partId === part.id);
                return (
                  <div key={part.id} className="space-y-2 rounded-md border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                        <span className="inline-flex size-6 items-center justify-center rounded border bg-muted font-mono text-xs">
                          {part.label}
                        </span>
                        your answer
                      </span>
                      <MarksStepper
                        value={selfMarks[part.id]}
                        max={part.marks}
                        onChange={(v) => setSelfMarks((prev) => ({ ...prev, [part.id]: v }))}
                      />
                    </div>
                    <p className="whitespace-pre-wrap rounded border bg-muted/40 p-2 text-xs text-muted-foreground">
                      {(partAnswers[part.id] ?? "").trim() || "(left blank)"}
                    </p>
                    {schemePart && schemePart.points.length > 0 ? (
                      <ul className="space-y-1.5">
                        {schemePart.points.map((p, i) => (
                          <li
                            key={`${p.ref ?? "pt"}-${i}`}
                            className="flex items-start gap-2 text-sm"
                          >
                            <span className="mt-0.5 shrink-0 rounded border border-slate-300 bg-slate-50 px-1 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                              {p.ref ?? "•"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <QuestionMarkdown>{p.text}</QuestionMarkdown>
                            </span>
                            <span className="mt-0.5 shrink-0 text-[11px] text-muted-foreground">
                              {p.marks} mark{p.marks === 1 ? "" : "s"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No scheme points published for this part.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {scheme.generalPoints.length > 0 && (
              <div className="mt-3 rounded-md border border-dashed p-3">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  General marking points
                </p>
                {scheme.generalPoints.map((p, i) => (
                  <QuestionMarkdown key={`${p.ref ?? "gp"}-${i}`}>{p.text}</QuestionMarkdown>
                ))}
              </div>
            )}
          </div>

          {recordError && (
            <Alert variant="destructive">
              <AlertDescription>{recordError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={recordSelfMarks} disabled={!allSelfMarked || recording}>
              {recording ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              )}
              Record my self-marks{allSelfMarked ? ` (${selfTotal}/${attempt.marksPossible})` : ""}
            </Button>
            <Button variant="ghost" onClick={onDone}>
              Skip — leave it for the teacher
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Self-marking updates your mastery estimate immediately. It is recorded
            separately from teacher marks (never in the κ calibration sample), and
            your teacher can still override it.
          </p>
        </div>
      )}
    </div>
  );
}
