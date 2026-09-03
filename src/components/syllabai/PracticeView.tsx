"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, Clock, Loader2, PenLine, Send, Timer, TriangleAlert, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import type { AttemptResultView, StudentQuestionView, StructuredAttemptResultView } from "@/lib/types";

const CONFIDENCE_LABELS = ["", "guessing", "unsure", "getting there", "confident", "certain"];

export function PracticeView({ onAttemptSubmitted }: { onAttemptSubmitted: () => void }) {
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.questions();
        if (!cancelled) setQuestions(list);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load questions");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const question = questions?.[index] ?? null;
  const isStructured = question?.type === "STRUCTURED";

  const nextQuestion = useCallback(() => {
    setResult(null);
    setStructuredResult(null);
    setChosen(null);
    setPartAnswers({});
    setSelfDoubt(false);
    setConfidence(3);
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
    return (
      <Alert>
        <AlertTitle>No questions seeded</AlertTitle>
        <AlertDescription>The question bank is empty — run the Flyway seed migrations.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
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
          <p className="text-sm leading-relaxed">{question.stem}</p>

          {structuredResult ? (
            <div className="space-y-4">
              <Alert>
                <Clock className="size-4 text-blue-600" aria-hidden="true" />
                <AlertTitle>Submitted for marking — {structuredResult.marksPossible} marks</AlertTitle>
                <AlertDescription>
                  Your written answers are stored and queued for marking. Marks and
                  feedback appear once your teacher (or the κ-gated Smart Mark engine)
                  has marked them — your mastery updates then.
                </AlertDescription>
              </Alert>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {structuredResult.parts.map((part) => (
                  <li key={part.partId} className="flex items-center justify-between gap-2">
                    <span>Part {part.label}</span>
                    <span className="text-xs">pending marks</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button onClick={nextQuestion}>Next question</Button>
              </div>
            </div>
          ) : result ? (
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
                <Button onClick={nextQuestion}>Next question</Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setResult(null);
                    setStructuredResult(null);
                    setChosen(null);
                    startedAt.current = Date.now();
                  }}
                >
                  Retry this question
                </Button>
              </div>
            </div>
          ) : (
            <>
              {isStructured ? (
                <div className="space-y-4">
                  {(question.parts ?? []).map((part) => (
                    <div key={part.id} className="space-y-1.5">
                      <Label htmlFor={part.id} className="text-sm font-semibold">
                        {part.label}) {part.commandWord ? `${part.commandWord} — ` : ""}
                        {part.prompt}
                        {part.marks > 0 && (
                          <span className="ml-1 font-normal text-muted-foreground">
                            ({part.marks} mark{part.marks > 1 ? "s" : ""})
                          </span>
                        )}
                      </Label>
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
              <RadioGroup
                value={chosen ?? ""}
                onValueChange={setChosen}
                className="gap-3"
                aria-label="Answer options"
              >
                {question.options.map((option) => (
                  <div
                    key={option.id}
                    className="flex items-start gap-3 rounded-lg border p-3 transition-colors has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5"
                  >
                    <RadioGroupItem value={option.id} id={option.id} className="mt-0.5" />
                    <Label htmlFor={option.id} className="cursor-pointer font-normal leading-relaxed">
                      <span className="mr-2 font-semibold">{option.label}.</span>
                      {option.text}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
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
