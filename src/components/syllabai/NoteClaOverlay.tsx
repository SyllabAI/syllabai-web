"use client";

/**
 * Note-anchored CLA overlay (Contextual Learning Assistant, notes slice).
 *
 * The CLA product shape on the Revision Notes reader: every open note carries
 * one overlay entry (the floating CLA button; the reader header's "Ask CLA"
 * opens the same panel), and the panel is EXPLICITLY CONTEXTUAL — it answers
 * only about the note being read, through the SAME production contract as the
 * assistant tab (`POST /api/v1/learners/me/cla/ask`), anchored to a
 * SPECIFICATION_POINT context: the note's spec-point code(s) resolve
 * server-side, fail-closed, VALIDATED-only, subject-isolated. The answer
 * arrives grounded with citations, evidence count and the read-only tool
 * trace — the deterministic topic anchor rides along in the result context.
 *
 * The 4 quick actions are the operator's spec, verbatim:
 *   Definitions · Summary · Pitfalls · Exam help
 * each mapping to a production ResponseMode (EXPLAIN/SUMMARIZE). HINT and
 * CHECK exist in the production vocabulary but are question-context modes
 * (attempt-gated in core's ClaLeakagePolicy) — they render disabled here, and
 * this surface never sends them. The exam-question CLA (anchored to
 * PAST_PAPER_QUESTION / QUESTION_PART contexts, where HINT/CHECK unlock
 * post-attempt) is a later, separate surface by operator decision.
 *
 * The transcript lives in React state lifted to the page (survives tab
 * switches, like the assistant tab) and is cleared when the note changes —
 * answers anchored to one note must never read as anchored to another.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  BookMarked,
  BookOpenText,
  GraduationCap,
  ListChecks,
  Loader2,
  Lock,
  Send,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { ApiError, aiAskErrorMessage, api } from "@/lib/api";
import type { ClaMode } from "@/lib/types";
import {
  AnswerBody,
  MetaRow,
  type ClaChatMessage,
} from "@/components/syllabai/ClaAssistantView";
import { cn } from "@/lib/utils";

/** Note-surface modes only — HINT/CHECK are question-context modes (later lane). */
type NoteMode = Extract<ClaMode, "EXPLAIN" | "SUMMARIZE">;

interface QuickAction {
  id: string;
  title: string;
  description: string;
  prompt: string;
  mode: NoteMode;
  icon: typeof BookMarked;
}

/** Operator spec, verbatim — titles, descriptions and prompts. */
const QUICK_ACTIONS: QuickAction[] = [
  {
    id: "definitions",
    title: "Definitions",
    description: "Define the key terms in this revision note",
    prompt: "Define the key terms in this revision note",
    mode: "EXPLAIN",
    icon: BookMarked,
  },
  {
    id: "summary",
    title: "Summary",
    description: "Summarise the key points",
    prompt: "Summarise the key points",
    mode: "SUMMARIZE",
    icon: ListChecks,
  },
  {
    id: "pitfalls",
    title: "Pitfalls",
    description: "Examine common misconceptions",
    prompt: "Examine common misconceptions",
    mode: "EXPLAIN",
    icon: TriangleAlert,
  },
  {
    id: "exam-help",
    title: "Exam help",
    description: "Tips for understanding this topic",
    prompt: "Give tips for understanding this topic and how it is examined",
    mode: "EXPLAIN",
    icon: GraduationCap,
  },
];

export function NoteClaOverlay({
  open,
  onOpenChange,
  rootId,
  noteTitle,
  subtopicTitle,
  specPointCodes,
  messages,
  setMessages,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** the subject root — scopes the server-side spec-point resolution */
  rootId: string | null;
  noteTitle: string;
  subtopicTitle: string | null;
  /** the note's spec-point codes; the first is the default anchor */
  specPointCodes: string[];
  messages: ClaChatMessage[];
  setMessages: Dispatch<SetStateAction<ClaChatMessage[]>>;
}) {
  // the anchor defaults to the note's first spec point; a multi-code note can
  // switch (chips below) — the server resolves whichever code is sent
  const [anchorCode, setAnchorCode] = useState<string>(specPointCodes[0] ?? "");
  const [freeMode, setFreeMode] = useState<NoteMode>("EXPLAIN");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAnchorCode(specPointCodes[0] ?? "");
  }, [specPointCodes]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  const ask = async (mode: NoteMode, question: string) => {
    const text = question.trim();
    if (!text || busy || !anchorCode) return;
    setMessages((m) => [...m, { kind: "user", text, at: Date.now() }]);
    setBusy(true);
    try {
      const result = await api.claAsk({
        kind: "SPECIFICATION_POINT",
        rootId: rootId ?? undefined,
        specCode: anchorCode,
        mode,
        question: text,
      });
      setMessages((m) => [...m, { kind: "assistant", result, at: Date.now() }]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // the §7 answer-leakage gate — guidance, not error (defensive: this
        // surface never sends HINT/CHECK, but the branch keeps the semantics)
        setMessages((m) => [...m, { kind: "gate", text: e.message, at: Date.now() }]);
      } else {
        // 404 keeps its specific guidance (unresolvable spec point); 5xx maps
        // to the honest AI-unavailable message (s136)
        const msg =
          e instanceof ApiError && e.status === 404
            ? "The server could not resolve this note's spec point in your subject — it may not be validated yet. Try another anchor code, or ask on the assistant tab."
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

  return (
    <>
      {/* the overlay entry — one floating CLA button while a note is open */}
      <Button
        size="sm"
        className="fixed bottom-6 right-6 z-40 h-12 gap-2 rounded-full px-5 shadow-lg"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        <Sparkles className="size-4" aria-hidden />
        CLA
      </Button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
          aria-describedby="note-cla-context"
        >
          <SheetHeader className="border-b px-4 py-3 text-left">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" aria-hidden />
              Contextual Learning Assistant
            </SheetTitle>
            <SheetDescription id="note-cla-context" className="text-xs">
              Grounded in the note you&apos;re reading — nothing else.
            </SheetDescription>
          </SheetHeader>

          {/* server-anchored context card: the note + its spec points. The
              anchor chips pick WHICH spec code is sent — the server resolves
              it fail-closed (data, not judgment, production §3) */}
          <div className="space-y-1.5 border-b bg-muted/40 px-4 py-3">
            <div className="flex items-start gap-2">
              <BookOpenText className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <p className="min-w-0 text-[13px] font-medium leading-snug">{noteTitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1 pl-6">
              {subtopicTitle && (
                <Badge variant="outline" className="text-[10px]">
                  {subtopicTitle}
                </Badge>
              )}
              {specPointCodes.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAnchorCode(c)}
                  aria-pressed={anchorCode === c}
                  title={
                    specPointCodes.length > 1
                      ? "Ask anchored to this spec point"
                      : undefined
                  }
                  className={cn(
                    "rounded-full border px-2 py-px font-mono text-[10px] transition-colors",
                    anchorCode === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="pl-6 text-[11px] leading-snug text-muted-foreground">
              Answers anchor to this note&apos;s spec point — the server resolves it
              from your subject, validated sources only.
            </p>
          </div>

          {/* mode vocabulary — EXPLAIN/SUMMARIZE select the free-input mode;
              HINT/CHECK are question-context modes (exam-question CLA, later) */}
          <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Mode
            </span>
            {(["EXPLAIN", "SUMMARIZE"] as const).map((m) => (
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
            {(["HINT", "CHECK"] as const).map((m) => (
              <span
                key={m}
                title="Question contexts only — arriving with the exam-question CLA (attempt-gated in production)"
                className="cursor-not-allowed rounded-full border border-dashed px-2.5 py-0.5 text-[11px] text-muted-foreground/60"
              >
                {m}
              </span>
            ))}
          </div>

          {/* the 4 quick options (operator spec, verbatim) */}
          <div className="grid grid-cols-2 gap-2 border-b px-4 py-3">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={busy}
                onClick={() => void ask(a.mode, a.prompt)}
                className="group flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5">
                  <a.icon className="size-3.5 text-primary" aria-hidden />
                  <span className="text-[13px] font-semibold">{a.title}</span>
                  <span className="ml-auto rounded-full bg-muted px-1.5 py-px font-mono text-[9px] font-medium text-muted-foreground">
                    {a.mode}
                  </span>
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {a.description}
                </span>
              </button>
            ))}
          </div>

          {/* transcript — the assistant tab's answer rendering, unchanged */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 px-4 py-3">
              {messages.length === 0 && !busy && (
                <p className="pt-2 text-center text-xs leading-relaxed text-muted-foreground">
                  Ask about this note — answers are grounded in validated material
                  for its spec point, cite the real sources, and refuse rather
                  than guess when the material doesn&apos;t cover your question.
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
                  Resolving the spec point → gathering validated evidence →
                  grounding the answer…
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
                void ask(freeMode, q);
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Ask anything about “${noteTitle.slice(0, 28)}${noteTitle.length > 28 ? "…" : ""}”`}
                maxLength={2000}
                disabled={busy}
                aria-label="Ask the contextual assistant about this note"
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
    </>
  );
}
