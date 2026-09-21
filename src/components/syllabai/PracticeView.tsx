"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2,
  Clock,
  Loader2,
  MessagesSquare,
  PenLine,
  Send,
  Sparkles,
  Timer,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  AttemptResultView,
  MarkSchemeRevealView,
  QuestionTaxonomyTopic,
  SelfMarkView,
  StudentQuestionView,
  StructuredAttemptResultView,
} from "@/lib/types";
import { MarksStepper } from "./MarksStepper";
import { QuestionHelpPanel } from "./QuestionHelpPanel";
import { QuestionMarkdown } from "./QuestionMarkdown";
import { SmartMarkPanel } from "./SmartMarkPanel";

const CONFIDENCE_LABELS = ["", "guessing", "unsure", "getting there", "confident", "certain"];

export function PracticeView({
  onAttemptSubmitted,
  topicNodeId = null,
  topicTitle = null,
  rootId = null,
  subjectName = null,
  onClearTopic,
  onAskTutorAbout,
}: {
  onAttemptSubmitted: () => void;
  /** Set when the dashboard/mastery map deep-links into practice for a topic. */
  topicNodeId?: string | null;
  topicTitle?: string | null;
  /** The selected subject's KG root — scopes the unfiltered practice list (session-56). */
  rootId?: string | null;
  /** The selected subject's display name, for the honest empty state. */
  subjectName?: string | null;
  onClearTopic?: () => void;
  /** Weakness→tutor loop leg: pre-fills an editable tutor question (never auto-sends). */
  onAskTutorAbout?: (draft: string) => void;
}) {
  const [questions, setQuestions] = useState<StudentQuestionView[] | null>(null);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [selfDoubt, setSelfDoubt] = useState(false);
  const [timed, setTimed] = useState(false);
  const [result, setResult] = useState<AttemptResultView | null>(null);
  const [partAnswers, setPartAnswers] = useState<Record<string, string>>({});
  const [structuredResult, setStructuredResult] = useState<StructuredAttemptResultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef<number>(Date.now());

  // session-112 topic picker: the taxonomy (same endpoint the exam-questions
  // sidebar uses) lets the learner CHOOSE a topic inside practice instead of
  // relying on a dashboard deep-link. pickerTouched keeps the deep-link in
  // charge until the learner actually picks something.
  const [taxonomyTopics, setTaxonomyTopics] = useState<QuestionTaxonomyTopic[] | null>(null);
  const [pickedTopicId, setPickedTopicId] = useState<string | null>(null);
  const [pickerTouched, setPickerTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .questionTaxonomy(rootId ?? undefined)
      .then((view) => {
        if (!cancelled) setTaxonomyTopics(view.sections.flatMap((s) => s.topics));
      })
      .catch(() => {
        // the picker is an affordance — practice must work without it
      });
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  // the effective topic: the learner's pick wins once made, then the deep-link
  const effectiveTopicId = pickerTouched ? pickedTopicId : topicNodeId;
  const effectiveTopic = taxonomyTopics?.find((t) => t.nodeId === effectiveTopicId) ?? null;

  useEffect(() => {
    let cancelled = false;
    setIndex(0);
    setResult(null);
    setStructuredResult(null);
    setChosen(null);
    setPartAnswers({});
    setError(null);
    // no stale question list from the previous topic under the new header
    setQuestions(null);
    // response timing is research data (§16): anchor it to the topic load,
    // not to app mount — a deep-linked topic hours into a session otherwise
    // records minutes of dead time in the first answer's responseTimeMs
    startedAt.current = Date.now();
    (async () => {
      try {
        const list = await api.questions(
          effectiveTopicId ?? undefined,
          effectiveTopicId ? undefined : (rootId ?? undefined),
        );
        if (!cancelled) setQuestions(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load questions");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveTopicId, rootId]);

  const question = questions?.[index] ?? null;
  const isStructured = question?.type === "STRUCTURED";

  const nextQuestion = useCallback(() => {
    setResult(null);
    setStructuredResult(null);
    setChosen(null);
    setPartAnswers({});
    setSelfDoubt(false);
    setConfidence(3);
    setError(null);
    startedAt.current = Date.now();
    setIndex((i) => (questions ? (i + 1) % questions.length : 0));
  }, [questions]);

  const allPartsAnswered = isStructured
    ? (question?.parts ?? []).every((part) => (partAnswers[part.id] ?? "").trim().length > 0)
    : Boolean(chosen);

  async function submitStructured() {
    if (!question || !allPartsAnswered) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.submitStructuredAttempt({
        questionId: question.id,
        partAnswers: (question.parts ?? []).map((part) => ({
          partId: part.id,
          answerText: partAnswers[part.id] ?? "",
        })),
        responseTimeMs: Date.now() - startedAt.current,
        confidence,
        selfDoubtFlag: selfDoubt,
        timedCondition: timed,
      });
      setStructuredResult(response);
      onAttemptSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit the attempt");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!question) return;
    if (isStructured) return submitStructured();
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.submitAttempt({
        questionId: question.id,
        chosenOptionId: chosen,
        responseTimeMs: Date.now() - startedAt.current,
        confidence,
        selfDoubtFlag: selfDoubt,
        timedCondition: timed,
      });
      setResult(response);
      onAttemptSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit the attempt");
    } finally {
      setBusy(false);
    }
  }

  if (questions === null && !error) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-10 w-1/2" />
      </div>
    );
  }

  if (error && questions === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Practice unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!question) {
    if (effectiveTopicId) {
      return (
        <div className="space-y-4">
          <TopicPicker
            taxonomyTopics={taxonomyTopics}
            value={effectiveTopicId}
            onChange={(v) => {
              setPickerTouched(true);
              setPickedTopicId(v);
            }}
            fallbackTitle={topicTitle}
          />
          <Alert>
            <AlertTitle>No questions on this topic yet</AlertTitle>
            <AlertDescription>
              {effectiveTopic?.title || topicTitle
                ? `No validated questions are linked to “${effectiveTopic?.title ?? topicTitle}” yet — questions surface here once validated content covers it.`
                : "No validated questions are linked to this topic yet."}
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <TopicPicker
          taxonomyTopics={taxonomyTopics}
          value={null}
          onChange={(v) => {
            setPickerTouched(true);
            setPickedTopicId(v);
          }}
          fallbackTitle={topicTitle}
        />
        <Alert>
          <AlertTitle>No validated questions in this subject yet</AlertTitle>
          <AlertDescription>
            {subjectName
              ? `No validated questions are linked to ${subjectName} yet — practice appears once validated content covers it.`
              : "The question bank is empty — run the Flyway seed migrations."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TopicPicker
        taxonomyTopics={taxonomyTopics}
        value={effectiveTopicId}
        onChange={(v) => {
          setPickerTouched(true);
          setPickedTopicId(v);
          // picking "all topics" also releases the dashboard deep-link
          if (v === null) onClearTopic?.();
        }}
        fallbackTitle={topicTitle}
      />
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {question.commandWord ?? "Answer"} · {question.marks} mark
                {question.marks > 1 ? "s" : ""}
              </CardTitle>
              <CardDescription>
                Question {index + 1} of {questions?.length ?? 0}
                {question.externalRef ? ` · ${question.externalRef}` : ""}
              </CardDescription>
            </div>
            <div className="flex shrink-0 gap-1">
              <Badge variant="outline">difficulty {question.difficulty}/5</Badge>
              <Badge variant="secondary">
                <Timer className="mr-1 size-3" aria-hidden="true" />
                ~{question.expectedTimeSeconds}s
              </Badge>
            </div>
          </div>
          <Progress value={((index + 1) / (questions?.length ?? 1)) * 100} aria-label="Quiz progress" />
        </CardHeader>
        <CardContent className="space-y-5">
          {question.stem ? <QuestionMarkdown>{question.stem}</QuestionMarkdown> : null}

          <QuestionHelpPanel question={question} />

          {structuredResult ? (
            <StructuredResultPanel
              question={question}
              result={structuredResult}
              partAnswers={partAnswers}
              onNext={nextQuestion}
            />
          ) : result ? (
            <McqResultPanel
              question={question}
              result={result}
              chosen={chosen}
              topicTitle={effectiveTopic?.title ?? topicTitle}
              onRetry={() => {
                setResult(null);
                setChosen(null);
                startedAt.current = Date.now();
              }}
              onNext={nextQuestion}
              onAskTutorAbout={onAskTutorAbout}
            />
          ) : (
            <>
              {isStructured ? (
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
                        onChange={(e) =>
                          setPartAnswers((prev) => ({ ...prev, [part.id]: e.target.value }))
                        }
                        placeholder="Write your answer…"
                        rows={3}
                        disabled={busy}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <McqChoiceGrid
                  options={question.options}
                  chosen={chosen}
                  onChoose={setChosen}
                  disabled={busy}
                  revealed={false}
                />
              )}

              <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="confidence">Confidence</Label>
                    <span className="text-xs text-muted-foreground">
                      {CONFIDENCE_LABELS[confidence]}
                    </span>
                  </div>
                  <Slider
                    id="confidence"
                    min={1}
                    max={5}
                    step={1}
                    value={[confidence]}
                    onValueChange={([v]) => setConfidence(v)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Self-reported calibration data (Paper B §3.5).
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="doubt"
                      checked={selfDoubt}
                      onCheckedChange={(v) => setSelfDoubt(v === true)}
                    />
                    <Label htmlFor="doubt" className="cursor-pointer text-sm font-normal">
                      I&apos;m unsure about this (self-doubt flag)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="timed"
                      checked={timed}
                      onCheckedChange={(v) => setTimed(v === true)}
                    />
                    <Label htmlFor="timed" className="cursor-pointer text-sm font-normal">
                      Practising under timed conditions
                    </Label>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Timed vs untimed feeds the fluency-gap construct (Paper B §16).
                  </p>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button onClick={submit} disabled={!allPartsAnswered || busy}>
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                {isStructured ? "Submit for marking" : "Submit answer"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── MCQ: the SME four-button choice grid ─────────────────────────────────────

function McqChoiceGrid({
  options,
  chosen,
  onChoose,
  disabled,
  revealed,
  correctOptionId,
}: {
  options: StudentQuestionView["options"];
  chosen: string | null;
  onChoose: (id: string) => void;
  disabled?: boolean;
  revealed?: boolean;
  correctOptionId?: string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Answer options">
      {options.map((option) => {
        const isSelected = chosen === option.id;
        const isCorrect = revealed && correctOptionId === option.id;
        const isWrongPick = revealed && isSelected && !isCorrect;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onChoose(option.id)}
            className={[
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              "hover:border-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              isSelected && !revealed ? "border-primary bg-primary/5 ring-1 ring-primary" : "",
              isCorrect ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40" : "",
              isWrongPick ? "border-destructive bg-destructive/10" : "",
              disabled && !revealed ? "opacity-60" : "",
            ].join(" ")}
          >
            <span
              className={[
                "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border font-semibold text-sm",
                isSelected && !revealed
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-muted",
                isCorrect ? "border-emerald-500 bg-emerald-500 text-white" : "",
                isWrongPick ? "border-destructive bg-destructive text-destructive-foreground" : "",
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
          </button>
        );
      })}
    </div>
  );
}

// ── MCQ result: verdict + correct choice + the SME worked solution ──────────

function McqResultPanel({
  question,
  result,
  chosen,
  topicTitle,
  onRetry,
  onNext,
  onAskTutorAbout,
}: {
  question: StudentQuestionView;
  result: AttemptResultView;
  chosen: string | null;
  topicTitle?: string | null;
  onRetry: () => void;
  onNext: () => void;
  onAskTutorAbout?: (draft: string) => void;
}) {
  const [scheme, setScheme] = useState<MarkSchemeRevealView | null>(null);
  const [schemeLoaded, setSchemeLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .markScheme(question.id)
      .then((s) => {
        if (!cancelled) {
          setScheme(s ?? null);
          setSchemeLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setSchemeLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [question.id]);

  const correctOption = question.options.find((o) => o.label === result.correctOptionLabel);

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
            ? "Your BKT mastery estimate for this topic has been updated."
            : `Correct answer: ${result.correctOptionLabel}. Your mastery estimate was updated — check “My state” for the misconception flag.`}
        </AlertDescription>
      </Alert>

      {revealedGrid(question, chosen, result)}

      {schemeLoaded && scheme && (scheme.generalPoints.length > 0 || scheme.parts.length > 0) && (
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
            The option you chose matches a documented misconception. The BDT engine
            raised its probability — a remediation step will be suggested once it
            becomes active.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onNext}>Next question</Button>
        <Button variant="outline" onClick={onRetry}>
          Retry this question
        </Button>
        {onAskTutorAbout && (
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              const stem = question?.stem.slice(0, 300) ?? "a question";
              const chosenLabel =
                question?.options.find((o) => o.id === chosen)?.label ?? "";
              const correctLabel = result.correctOptionLabel ?? "";
              onAskTutorAbout(
                result.correct
                  ? `I answered this question correctly${
                      topicTitle ? ` on ${topicTitle}` : ""
                    }: "${stem}" — I chose ${chosenLabel}, which was the right answer. Can you explain the chemistry behind it and what related ideas I should review to make sure I really understand it?`
                  : `I got this question wrong${
                      topicTitle ? ` on ${topicTitle}` : ""
                    } and I don't understand why. The question was: "${stem}" — I chose ${chosenLabel} but the correct answer was ${correctLabel}. Can you explain the chemistry behind the correct answer?`,
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

function revealedGrid(
  question: StudentQuestionView,
  chosen: string | null,
  result: AttemptResultView,
) {
  const correctOptionId =
    question.options.find((o) => o.label === result.correctOptionLabel)?.id ?? null;
  return (
    <McqChoiceGrid
      options={question.options}
      chosen={chosen}
      onChoose={() => {}}
      disabled
      revealed
      correctOptionId={correctOptionId}
    />
  );
}

// ── Structured result: pending queue + the SME reveal-and-self-mark flow ─────

function StructuredResultPanel({
  question,
  result,
  partAnswers,
  onNext,
}: {
  question: StudentQuestionView;
  result: StructuredAttemptResultView;
  partAnswers: Record<string, string>;
  onNext: () => void;
}) {
  const [scheme, setScheme] = useState<MarkSchemeRevealView | null>(null);
  const [schemeState, setSchemeState] = useState<"idle" | "loading" | "open" | "withheld" | "error">(
    "idle",
  );
  const [selfMarks, setSelfMarks] = useState<Record<string, number>>({});
  const [selfMarkResult, setSelfMarkResult] = useState<SelfMarkView | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  // student Smart Mark (F-047 learner half): the AI-marking alternative to
  // reveal-and-self-mark — once opened it owns the flow until "Next question"
  const [smartMarkOpened, setSmartMarkOpened] = useState(false);

  const parts = question.parts ?? [];
  const allSelfMarked =
    parts.length > 0 && parts.every((p) => typeof selfMarks[p.id] === "number");
  const selfTotal = parts.reduce((sum, p) => sum + (selfMarks[p.id] ?? 0), 0);

  function reveal() {
    setSchemeState("loading");
    api
      .markScheme(question.id)
      .then((s) => {
        if (s) {
          setScheme(s);
          setSchemeState("open");
        } else {
          setSchemeState("withheld");
        }
      })
      .catch(() => setSchemeState("error"));
  }

  async function recordSelfMarks() {
    if (!allSelfMarked || !result.attemptId) return;
    setRecording(true);
    setRecordError(null);
    try {
      const view = await api.selfMarkAttempt(
        result.attemptId,
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
            Your self-assessment is recorded and your mastery estimate has been
            updated{selfMarkResult.evidenceFired ? " (evidence fired)" : ""}. Your teacher
            can still review and override it later — self-marks never enter the
            teacher κ calibration sample.
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={onNext}>Next question</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Clock className="size-4 text-blue-600" aria-hidden="true" />
        <AlertTitle>Submitted — {result.marksPossible} marks</AlertTitle>
        <AlertDescription>
          Your written answers are stored and queued for teacher marking. Or mark
          it yourself now against the mark scheme — Save-My-Exams style.
        </AlertDescription>
      </Alert>

      {schemeState === "idle" && !smartMarkOpened && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-1.5" onClick={reveal}>
            <PenLine className="size-4" aria-hidden="true" />
            Reveal mark scheme &amp; self-mark
          </Button>
          <Button className="gap-1.5" onClick={() => setSmartMarkOpened(true)}>
            <Sparkles className="size-4" aria-hidden="true" />
            Open Smart Mark
          </Button>
        </div>
      )}

      {schemeState === "idle" && smartMarkOpened && (
        <SmartMarkPanel
          question={question}
          attemptId={result.attemptId}
          marksPossible={result.marksPossible}
          partAnswers={partAnswers}
          onNext={onNext}
        />
      )}

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
              Record my self-marks{allSelfMarked ? ` (${selfTotal}/${result.marksPossible})` : ""}
            </Button>
            <Button variant="ghost" onClick={onNext}>
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


// ── topic picker: the taxonomy as an in-practice Select (session-112) ───────

function TopicPicker({
  taxonomyTopics,
  value,
  onChange,
  fallbackTitle,
}: {
  taxonomyTopics: QuestionTaxonomyTopic[] | null;
  /** the effective topic node id, or null for "all topics" */
  value: string | null;
  onChange: (nodeId: string | null) => void;
  /** deep-linked title, shown when the topic isn't in the taxonomy (0 questions) */
  fallbackTitle?: string | null;
}) {
  const inTaxonomy = taxonomyTopics?.some((t) => t.nodeId === value) ?? false;
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5">
      <Select
        value={value ?? "all"}
        onValueChange={(v) => onChange(v === "all" ? null : v)}
      >
        <SelectTrigger className="h-8 w-full max-w-72 bg-background text-sm" aria-label="Practise topic">
          <SelectValue placeholder={taxonomyTopics === null ? "Loading topics…" : "Topic"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All topics</SelectItem>
          {value && !inTaxonomy && (
            <SelectItem value={value}>{fallbackTitle ?? "Selected topic"}</SelectItem>
          )}
          {(taxonomyTopics ?? []).map((topic) => (
            <SelectItem key={topic.nodeId} value={topic.nodeId}>
              {topic.title} ({topic.questionCount})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="min-w-0 truncate text-xs text-muted-foreground">
        {value
          ? "Practising one topic — pick another any time"
          : "Cycling every topic in this subject"}
      </p>
    </div>
  );
}
