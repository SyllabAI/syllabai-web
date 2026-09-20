"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  Loader2,
  MessagesSquare,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type {
  SmartMarkAttemptView,
  SmartMarkPartResult,
  StudentQuestionView,
} from "@/lib/types";
import { QuestionMarkdown } from "./QuestionMarkdown";

/**
 * The student Smart Mark flow (F-047 learner half): one button AI-marks every
 * part of the attempt through the same pipeline the teacher queue uses, then
 * each marked part offers the two feedback actions — "Explain my feedback" and
 * "Improve my answer". Deliberately button-driven, never a text box: grounding
 * (question, answer, decisions) is resolved server-side from opaque ids.
 */
export function SmartMarkPanel({
  question,
  attemptId,
  marksPossible,
  partAnswers,
  onNext,
}: {
  question: StudentQuestionView;
  attemptId: string;
  marksPossible: number;
  partAnswers: Record<string, string>;
  onNext: () => void;
}) {
  const [marking, setMarking] = useState(false);
  const [result, setResult] = useState<SmartMarkAttemptView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSmartMark() {
    setMarking(true);
    setError(null);
    try {
      const view = await api.smartMarkAttempt(attemptId);
      setResult(view);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Smart Mark could not run — try again shortly.",
      );
    } finally {
      setMarking(false);
    }
  }

  if (marking) {
    return (
      <div className="space-y-3">
        <Alert>
          <Loader2 className="size-4 animate-spin text-blue-600" aria-hidden="true" />
          <AlertTitle>Smart Mark is reading your answers…</AlertTitle>
          <AlertDescription>
            It checks each answer against the mark scheme&apos;s points, exactly
            like an examiner — this usually takes a few seconds per part.
          </AlertDescription>
        </Alert>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-4/5" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2">
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {error}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-1.5" onClick={runSmartMark}>
            <Sparkles className="size-4" aria-hidden="true" />
            Try Smart Mark again
          </Button>
          <Button variant="ghost" onClick={onNext}>
            Skip — next question
          </Button>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button className="gap-1.5" onClick={runSmartMark}>
          <Sparkles className="size-4" aria-hidden="true" />
          Open Smart Mark
        </Button>
        <Button variant="ghost" onClick={onNext}>
          Skip — next question
        </Button>
      </div>
    );
  }

  const totalAwarded = result.parts.reduce((sum, p) => sum + p.marksAwarded, 0);

  return (
    <div className="space-y-4">
      <Alert>
        <Sparkles className="size-4 text-violet-600" aria-hidden="true" />
        <AlertTitle>
          Smart Marked — {totalAwarded}/{marksPossible} marks
        </AlertTitle>
        <AlertDescription>
          {result.schemeValidationState === "SUGGESTED"
            ? "Marked against an AI-extracted mark scheme that is still awaiting teacher validation — treat the result as a guide."
            : "Marked point by point against the official mark scheme, following the marking guidelines."}{" "}
          {result.parts.every((p) => p.authoritative)
            ? "Your mastery estimate has been updated."
            : "These marks are provisional feedback — your mastery updates when the κ release gate passes or your teacher confirms them."}
        </AlertDescription>
      </Alert>

      {result.parts.map((part) => (
        <PartResultCard
          key={part.partId}
          part={part}
          attemptId={attemptId}
          answerText={(partAnswers[part.partId] ?? "").trim()}
        />
      ))}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onNext}>Next question</Button>
      </div>
    </div>
  );
}

function PartResultCard({
  part,
  attemptId,
  answerText,
}: {
  part: SmartMarkPartResult;
  attemptId: string;
  answerText: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <span className="inline-flex size-6 items-center justify-center rounded border bg-muted font-mono text-xs">
            {part.label}
          </span>
          your answer
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {part.authoritative ? (
            <Badge className="bg-emerald-600 text-white">mastery updated</Badge>
          ) : (
            <Badge variant="outline">provisional</Badge>
          )}
          <Badge variant="secondary">
            {part.marksAwarded}/{part.marksPossible} marks
          </Badge>
        </div>
      </div>

      {answerText ? (
        <p className="whitespace-pre-wrap rounded border bg-background p-2 text-xs text-muted-foreground">
          {answerText}
        </p>
      ) : (
        <p className="text-xs italic text-muted-foreground">(left blank)</p>
      )}

      {!part.validationPassed && part.failureReason ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Smart Mark could not complete this part ({part.failureReason}) — it
          stays in the teacher marking queue.
        </p>
      ) : (
        <ul className="space-y-2">
          {part.breakdown.map((point, i) => (
            <li
              key={`${point.ref ?? "pt"}-${i}`}
              className="rounded-md border bg-background p-2.5"
            >
              <div className="flex items-start gap-2">
                {point.awarded ? (
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm">
                    {point.pointText ? (
                      <QuestionMarkdown>{point.pointText}</QuestionMarkdown>
                    ) : (
                      <span className="font-mono text-xs">{point.ref ?? "point"}</span>
                    )}{" "}
                    <span className="text-[11px] text-muted-foreground">
                      · {point.marks} mark{point.marks === 1 ? "" : "s"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{point.rationale}</p>
                  {point.awarded && point.evidence ? (
                    <p className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Your evidence: “{point.evidence}”
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {part.validationPassed && <FeedbackActions part={part} attemptId={attemptId} />}
    </div>
  );
}

/**
 * The two post-marking actions — buttons only, no text box. The generations
 * are grounded on the recorded decisions server-side; each result stays until
 * the student leaves the panel.
 */
function FeedbackActions({ part, attemptId }: { part: SmartMarkPartResult; attemptId: string }) {
  const [explaining, setExplaining] = useState(false);
  const [improving, setImproving] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function explain() {
    setExplaining(true);
    setActionError(null);
    try {
      const view = await api.explainSmartFeedback(attemptId, part.partId);
      setExplanation(view.explanation);
    } catch (err) {
      setActionError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "The explanation could not be generated — try again.",
      );
    } finally {
      setExplaining(false);
    }
  }

  async function improve() {
    setImproving(true);
    setActionError(null);
    try {
      const view = await api.smartImprovementPlan(attemptId, part.partId);
      setPlan(view.plan);
    } catch (err) {
      setActionError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "The improvement plan could not be generated — try again.",
      );
    } finally {
      setImproving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={explain}
          disabled={explaining || improving}
        >
          {explaining ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <MessagesSquare className="size-3.5" aria-hidden="true" />
          )}
          Explain my feedback
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={improve}
          disabled={explaining || improving}
        >
          {improving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <TrendingUp className="size-3.5" aria-hidden="true" />
          )}
          Improve my answer
        </Button>
      </div>

      {actionError && (
        <p className="text-xs text-destructive">{actionError}</p>
      )}

      {explanation && (
        <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-300">
            <CircleAlert className="size-3.5" aria-hidden="true" />
            Why you got this mark
          </p>
          <div className="text-sm leading-relaxed">
            <QuestionMarkdown>{explanation}</QuestionMarkdown>
          </div>
        </div>
      )}

      {plan && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
            <Lightbulb className="size-3.5" aria-hidden="true" />
            How to improve
          </p>
          <div className="text-sm leading-relaxed">
            <QuestionMarkdown>{plan}</QuestionMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
