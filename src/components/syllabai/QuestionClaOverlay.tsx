"use client";

/**
 * Question-anchored CLA overlay (Contextual Learning Assistant, exam-questions
 * slice, s129).
 *
 * The CLA product shape on the Exam Questions browser: every question card
 * carries one overlay entry (the header strip's "Ask CLA"), and each answer
 * box's lightbulb opens the same panel pre-targeted at that part. The panel
 * answers only about the question being read, through the SAME production
 * contract as the notes overlay and the assistant tab
 * (`POST /api/v1/learners/me/cla/ask`), anchored to:
 *
 *   Understand — PAST_PAPER_QUESTION on the family's first row (the whole
 *                question; the server serves the stem AND every part prompt
 *                as id-anchored lead evidence — the SME corpus keeps most
 *                structured questions' text in the parts)
 *   Approach   — QUESTION_PART on the selected answer box (part-scoped
 *                scaffolding: the box's prompt, command word and marks ride
 *                the anchor), or PAST_PAPER_QUESTION on an MCQ row (an MCQ
 *                is atomic — the row IS the part)
 *
 * The 2 quick actions are the operator's spec:
 *   Understand · Approach
 * Understand maps to EXPLAIN — which on question contexts is DECODE-ONLY in
 * core (command words, marks, examiner intent; never the answer). Approach
 * maps to HINT — scaffolding only, no final answers, no scheme points, pre-
 * or post-attempt (deterministic in core's ClaLeakagePolicy). CHECK stays
 * out of this surface by operator decision: post-attempt review belongs to
 * Smart Mark ("Explain my feedback" / "Improve my answer"), so it renders
 * disabled with that pointer. SUMMARIZE is a topic/notes mode and renders
 * disabled with its pointer too.
 *
 * Transcripts live in React state lifted to the page, keyed by the unit key
 * (one transcript per whole question — a family's parts share the question's
 * context; switching questions switches transcripts, and answers anchored to
 * one question never read as anchored to another).
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertTriangle,
  Compass,
  Lightbulb,
  ListChecks,
  Loader2,
  Lock,
  Send,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { ApiError, aiAskErrorMessage, api } from "@/lib/api";
import type { ClaMode, PartView, StudentQuestionView } from "@/lib/types";
import type { ExamQuestionUnit } from "@/lib/exam-families";
import {
  AnswerBody,
  MetaRow,
  type ClaChatMessage,
} from "@/components/syllabai/ClaAssistantView";
import { cn } from "@/lib/utils";

/** Question-surface free-input modes — the two that mean anything here. */
type QuestionMode = Extract<ClaMode, "EXPLAIN" | "HINT">;

/** One Approach target: an answer box (QUESTION_PART) or an atomic MCQ row. */
type ClaTarget = {
  id: string;
  anchor: "QUESTION_PART" | "PAST_PAPER_QUESTION";
  /** chip label — matches the label chips the learner sees on the card */
  label: string;
  marks: number;
  commandWord: string | null;
};

/**
 * Derive the Approach targets from the unit, in card order:
 * - a structured row contributes one target PER answer box (the box prompt is
 *   where that question's text lives — 394/692 SME structured stems are blank)
 * - an MCQ row contributes itself (atomic — the row IS the part)
 * Labels: single-row units use the box labels (a, b, c — exactly the card);
 * multi-row families use the row position letter (the SME sub-question).
 */
export function claTargetsOf(unit: ExamQuestionUnit): ClaTarget[] {
  const targets: ClaTarget[] = [];
  unit.parts.forEach((row: StudentQuestionView, rowIdx: number) => {
    const rowLetter = String.fromCharCode(97 + rowIdx);
    if (row.type === "STRUCTURED") {
      const boxes: PartView[] = row.parts ?? [];
      if (boxes.length === 0) {
        targets.push({
          id: row.id,
          anchor: "PAST_PAPER_QUESTION",
          label: unit.multi ? rowLetter : "question",
          marks: row.marks,
          commandWord: row.commandWord,
        });
        return;
      }
      boxes.forEach((box) =>
        targets.push({
          id: box.id,
          anchor: "QUESTION_PART",
          label:
            unit.multi && unit.parts.length > 1
              ? boxes.length === 1
                ? rowLetter
                : `${rowLetter}·${box.label}`
              : box.label,
          marks: box.marks,
          commandWord: box.commandWord,
        }),
      );
    } else {
      targets.push({
        id: row.id,
        anchor: "PAST_PAPER_QUESTION",
        label: unit.multi ? rowLetter : "question",
        marks: row.marks,
        commandWord: row.commandWord,
      });
    }
  });
  return targets;
}

export function QuestionClaOverlay({
  open,
  onOpenChange,
  rootId,
  unit,
  questionNumber,
  initialTargetId,
  messages,
  setMessages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the subject root — scopes the server-side part → question resolution */
  rootId: string | null;
  /** the open question's whole unit (the anchor's owning family) */
  unit: ExamQuestionUnit | null;
  /** 1-based display number of the card (the header chip the learner sees) */
  questionNumber: number | null;
  /** a box/row id to pre-aim Approach at (from a part's lightbulb button) */
  initialTargetId: string | null;
  messages: ClaChatMessage[];
  setMessages: Dispatch<SetStateAction<ClaChatMessage[]>>;
}) {
  const [freeMode, setFreeMode] = useState<QuestionMode>("HINT");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [targetId, setTargetId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const targets = useMemo(() => (unit ? claTargetsOf(unit) : []), [unit]);

  // the part lightbulb pre-aims Approach; every other open resets to the
  // first target (the overlay's target is per-open, the transcript per-unit)
  useEffect(() => {
    if (!open) return;
    setTargetId(
      initialTargetId && targets.some((t) => t.id === initialTargetId)
        ? initialTargetId
        : (targets[0]?.id ?? null),
    );
  }, [open, unit, initialTargetId, targets]);

  const target = targets.find((t) => t.id === targetId) ?? targets[0] ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const ask = async (
    anchor: { kind: "WHOLE" } | { kind: "TARGET"; target: ClaTarget },
    mode: QuestionMode,
    question: string,
  ) => {
    const text = question.trim();
    if (!text || busy || !unit) return;
    setMessages((m) => [...m, { kind: "user", text, at: Date.now() }]);
    setBusy(true);
    try {
      const result = await api.claAsk(
        anchor.kind === "TARGET" && anchor.target.anchor === "QUESTION_PART"
          ? {
              kind: "QUESTION_PART",
              rootId: rootId ?? undefined,
              partId: anchor.target.id,
              mode,
              question: text,
            }
          : {
              kind: "PAST_PAPER_QUESTION",
              questionId:
                anchor.kind === "TARGET" ? anchor.target.id : unit.parts[0].id,
              mode,
              question: text,
            },
      );
      setMessages((m) => [...m, { kind: "assistant", result, at: Date.now() }]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // the §7 answer-leakage gate — guidance, not error (defensive: this
        // surface never sends CHECK, but the branch keeps the semantics)
        setMessages((m) => [...m, { kind: "gate", text: e.message, at: Date.now() }]);
      } else {
        // 404 keeps its specific guidance (unresolvable question/anchor); 5xx
        // maps to the honest AI-unavailable message (s136)
        const msg =
          e instanceof ApiError && e.status === 404
            ? "The server could not anchor this question — it may not be validated for serving yet. Try again later, or ask on the assistant tab."
            : aiAskErrorMessage(e, "Request failed");
        setMessages((m) => [
          ...m,
          { kind: "error", text: msg, question: text, at: Date.now() },
        ]);
      }
    } finally {
      setBusy(false);
    }
  };

  const understandPrompt =
    "What is this question asking me to do? Walk through each part — the command words, the marks, and what the examiner is looking for. Don't tell me the answers.";
  const approachPrompt = target
    ? target.anchor === "QUESTION_PART"
      ? `Help me work through part (${target.label}) step by step — coach me toward the answer without giving it away.`
      : "Help me work through this question step by step — coach me toward the answer without giving it away."
    : "";

  const hideTargetRow = targets.length <= 1 && targets[0]?.label === "question";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        aria-describedby="question-cla-context"
      >
        <SheetHeader className="border-b px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Contextual Learning Assistant
          </SheetTitle>
          <SheetDescription id="question-cla-context" className="text-xs">
            Grounded in this question — nothing else, and never its mark scheme
            before you attempt.
          </SheetDescription>
        </SheetHeader>

        {/* server-anchored context card: the question IS the anchor — the
            server resolves the whole family's first row and serves the stem
            plus every part prompt as id-anchored lead evidence */}
        <div className="space-y-1.5 border-b bg-muted/40 px-4 py-3">
          <div className="flex items-start gap-2">
            <Compass className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <p className="min-w-0 text-[13px] font-medium leading-snug">
              {questionNumber != null ? `Question ${questionNumber}` : "Question"}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {unit?.marks} mark{unit?.marks === 1 ? "" : "s"}
                {unit && unit.parts.length > 1
                  ? ` · ${unit.parts.length} parts`
                  : ""}
              </span>
            </p>
          </div>
          {unit?.ref ? (
            <p className="pl-6 font-mono text-[10px] text-muted-foreground">{unit.ref}</p>
          ) : null}
          <p className="pl-6 text-[11px] leading-snug text-muted-foreground">
            Answers are grounded in this question&apos;s own text plus validated
            material for its topic. The mark scheme is deterministically
            excluded until you attempt.
          </p>
        </div>

        {/* Approach target — which part the coaching is about. Understand is
            always the whole question; this row aims Approach (and free asks
            that reference "this part") */}
        {!hideTargetRow && targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Part
            </span>
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTargetId(t.id)}
                aria-pressed={target?.id === t.id}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  target?.id === t.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* mode vocabulary — EXPLAIN/HINT select the free-input mode; SUMMARIZE
            is a topic/notes mode, CHECK is post-attempt review that lives with
            Smart Mark (operator decision, s129) */}
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Mode
          </span>
          {(["EXPLAIN", "HINT"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setFreeMode(m)}
              aria-pressed={freeMode === m}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                freeMode === m
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              {m}
            </button>
          ))}
          <span
            title="Summarise is a topic/notes mode — use the notes overlay or the assistant tab"
            className="cursor-not-allowed rounded-full border border-dashed px-2.5 py-0.5 text-[11px] text-muted-foreground/60"
          >
            SUMMARIZE
          </span>
          <span
            title="Post-attempt review lives with Smart Mark (Explain my feedback) — attempt-gated in production"
            className="cursor-not-allowed rounded-full border border-dashed px-2.5 py-0.5 text-[11px] text-muted-foreground/60"
          >
            CHECK
          </span>
        </div>

        {/* the 2 quick options (operator spec) */}
        <div className="grid grid-cols-1 gap-2 border-b px-4 py-3">
          <button
            type="button"
            disabled={busy || !unit}
            onClick={() => void ask({ kind: "WHOLE" }, "EXPLAIN", understandPrompt)}
            className="group flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              <Compass className="size-3.5 text-primary" aria-hidden />
              <span className="text-[13px] font-semibold">Understand</span>
              <span className="ml-auto rounded-full bg-muted px-1.5 py-px font-mono text-[9px] font-medium text-muted-foreground">
                EXPLAIN
              </span>
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              Explain what this question is asking — command words, marks and
              examiner intent, part by part. Never the answers.
            </span>
          </button>
          <button
            type="button"
            disabled={busy || !target}
            onClick={() => target && void ask({ kind: "TARGET", target }, "HINT", approachPrompt)}
            className="group flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="flex items-center gap-1.5">
              <Lightbulb className="size-3.5 text-primary" aria-hidden />
              <span className="text-[13px] font-semibold">Approach</span>
              {target && (
                <span className="rounded-full bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground">
                  part {target.label}
                </span>
              )}
              <span className="ml-auto rounded-full bg-muted px-1.5 py-px font-mono text-[9px] font-medium text-muted-foreground">
                HINT
              </span>
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">
              {target?.anchor === "QUESTION_PART"
                ? `Help me work through part (${target?.label}) — scaffolded steps toward the answer, never the answer itself.`
                : "Help me work through this question — scaffolded steps toward the answer, never the answer itself."}
            </span>
          </button>
        </div>

        {/* transcript — the assistant tab's answer rendering, unchanged */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 px-4 py-3">
            {messages.length === 0 && !busy && (
              <p className="pt-2 text-center text-xs leading-relaxed text-muted-foreground">
                Ask about this question — Understand decodes what each part is
                asking (never the answers); Approach coaches you through the
                part you pick without giving it away.
              </p>
            )}
            {messages.map((m, i) =>
              m.kind === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {m.text}
                  </div>
                </div>
              ) : m.kind === "assistant" ? (
                <div
                  key={i}
                  className={cn(
                    "space-y-2.5 rounded-lg border bg-card px-3 py-2.5",
                    m.result.refused && "border-amber-500/40",
                  )}
                >
                  {m.result.refused && (
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      Honest refusal — the anchored material doesn&apos;t support
                      an answer to this
                    </p>
                  )}
                  <AnswerBody result={m.result} />
                  <Separator />
                  <MetaRow result={m.result} />
                  {m.result.tools.length > 0 && (
                    <details className="text-[11px] text-muted-foreground">
                      <summary className="flex cursor-pointer items-center gap-1 hover:text-foreground">
                        <Wrench className="h-3 w-3" /> read-only tools used (
                        {m.result.tools.length})
                      </summary>
                      <ul className="mt-1 space-y-0.5 pl-4">
                        {m.result.tools.map((t, ti) => (
                          <li key={ti}>
                            {t.tool} · {t.resultSize} result(s) · {t.latencyMs}ms
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ) : m.kind === "gate" ? (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400"
                >
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{m.text}</span>
                </div>
              ) : (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {m.text}
                    <br />
                    <button
                      className="mt-1 underline hover:no-underline"
                      onClick={() => setDraft(m.question)}
                    >
                      Restore question
                    </button>
                  </span>
                </div>
              ),
            )}
            {busy && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Resolving this question → gathering its parts + validated
                evidence → grounding the answer…
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* free input */}
        <div className="border-t px-4 py-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const q = draft;
              setDraft("");
              void ask(
                freeMode === "HINT" && target
                  ? { kind: "TARGET", target }
                  : { kind: "WHOLE" },
                freeMode,
                q,
              );
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                freeMode === "HINT" && target?.anchor === "QUESTION_PART"
                  ? `Ask about part (${target.label})…`
                  : "Ask about this question…"
              }
              maxLength={2000}
              disabled={busy}
              aria-label="Ask the contextual assistant about this question"
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy || !draft.trim()}
              aria-label="Send"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
            </Button>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
