"use client";

/**
 * T-025 — Tutor chat UI (F-041 chat interface + F-043 citation display).
 *
 * Consumes the T-024 backend surface `POST /api/v1/tutor/ask` (synchronous —
 * no SSE backend exists yet; loading/error/refusal states cover the wait).
 * The answer arrives with `[n]` citation markers; each marker renders as a
 * reference chip that jumps to the matching citation card, which shows the
 * verbatim source label (e.g. "Mark scheme — p6", "Specification topic …").
 *
 * v0 scope decisions (documented, not silent):
 * - The transcript lives in React state lifted to the page (survives tab
 *   switches). Server-side session persistence arrives with the Spec §22
 *   `tutor/sessions` endpoints — not invented here.
 * - Citation deep links currently target the teacher content API / KG nodes
 *   (raw JSON surfaces). Learners see the citation as a reference card;
 *   teacher/admin users additionally get an "Open source" anchor. In-app PDF
 *   deep-linking is F-022's surface and lands later.
 * - Refusals (no grounded evidence) render distinctly — they are deterministic
 *   (provider "deterministic-refusal", no LLM call).
 * - Model/provider/latency/evidence-count are shown with every answer
 *   (research traceability, Master Spec §19).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ExternalLink, GraduationCap, Quote, RotateCcw, Send } from "lucide-react";
import { ApiError, api, apiPath, currentUser } from "@/lib/api";
import type { TutorAnswerView, TutorCitation } from "@/lib/types";

const MAX_QUESTION_CHARS = 2000; // mirrors the backend @Size(max = 2000)

export type TutorChatMessage =
  | { kind: "user"; text: string; at: number }
  | { kind: "assistant"; result: TutorAnswerView; at: number }
  | { kind: "error"; text: string; question: string; at: number };

const SUGGESTED_QUESTIONS = [
  "Explain how to calculate moles from mass and Mr.",
  "What is the difference between ionic and covalent bonding?",
  "How do I balance a redox half-equation in acidic solution?",
];

/** Split an answer into plain-text segments and [n] marker positions. */
function parseMarkers(answer: string): { text: string; marker: number | null }[] {
  const parts: { text: string; marker: number | null }[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    if (m.index > last) parts.push({ text: answer.slice(last, m.index), marker: null });
    parts.push({ text: m[1], marker: Number(m[1]) });
    last = re.lastIndex;
  }
  if (last < answer.length) parts.push({ text: answer.slice(last), marker: null });
  return parts;
}

function isTeacherLike(): boolean {
  const roles = currentUser()?.roles ?? [];
  return roles.includes("TEACHER") || roles.includes("ADMIN");
}

export function TutorChatView({
  messages,
  setMessages,
}: {
  messages: TutorChatMessage[];
  setMessages: (next: TutorChatMessage[]) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [highlightedCitation, setHighlightedCitation] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const teacher = isTeacherLike();

  // keep the newest message in view
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages]);

  const inputTrimmed = input.trim();
  const canSend = sending || inputTrimmed.length === 0 || inputTrimmed.length > MAX_QUESTION_CHARS;

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > MAX_QUESTION_CHARS || sending) return;
    setInput("");
    setMessages([...messages, { kind: "user", text: trimmed, at: Date.now() }]);
    setSending(true);
    try {
      const result = await api.tutorAsk(trimmed);
      setMessages([
        ...messages,
        { kind: "user", text: trimmed, at: Date.now() },
        { kind: "assistant", result, at: Date.now() },
      ]);
    } catch (err) {
      const text =
        err instanceof ApiError
          ? err.message
          : "The tutor could not be reached. Check your connection and try again.";
      setMessages([
        ...messages,
        { kind: "user", text: trimmed, at: Date.now() },
        { kind: "error", text, question: trimmed, at: Date.now() },
      ]);
    } finally {
      setSending(false);
    }
  }

  function jumpToCitation(messageIndex: number, citation: TutorCitation) {
    const id = `citation-${messageIndex}-${citation.index}`;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedCitation(id);
    window.setTimeout(() => setHighlightedCitation(null), 1600);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-1 pt-6">
          <div className="flex items-center gap-2">
            <GraduationCap className="size-4 text-primary" aria-hidden="true" />
            <p className="text-sm font-semibold">Ask the SyllabAI tutor</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Grounded answers with verbatim citations from validated course content —
            mark schemes, question papers and the specification.
          </p>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-background">
        <ScrollArea className="h-[52vh] min-h-80">
          <div ref={transcriptRef} className="flex flex-col gap-4 p-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <GraduationCap className="size-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  Ask a chemistry question — the tutor answers only from grounded course
                  evidence and cites every source.
                </p>
                <div className="flex flex-col gap-2 pt-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <Button
                      key={q}
                      variant="outline"
                      size="sm"
                      className="justify-start text-left font-normal"
                      onClick={() => setInput(q)}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => {
              if (message.kind === "user") {
                return (
                  <div key={index} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap">
                      {message.text}
                    </div>
                  </div>
                );
              }

              if (message.kind === "error") {
                return (
                  <div key={index} className="flex flex-col items-start gap-2">
                    <div className="max-w-[90%] rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
                      <p className="flex items-center gap-1.5 font-medium">
                        <AlertTriangle className="size-4" aria-hidden="true" />
                        Something went wrong
                      </p>
                      <p className="mt-0.5">{message.text}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => send(message.question)}
                      disabled={sending}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      Retry
                    </Button>
                  </div>
                );
              }

              return (
                <AssistantMessage
                  key={index}
                  messageIndex={index}
                  result={message.result}
                  highlightedCitation={highlightedCitation}
                  teacher={teacher}
                  onCitationJump={jumpToCitation}
                />
              );
            })}

            {sending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="flex gap-1">
                  <span className="size-2 animate-pulse rounded-full bg-muted-foreground/60" />
                  <span className="size-2 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                  <span className="size-2 animate-pulse rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                </span>
                Searching course evidence…
              </div>
            )}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex flex-col gap-2 p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about a topic, a past-paper question, or a mark scheme…"
              aria-label="Your question for the tutor"
              rows={2}
              maxLength={MAX_QUESTION_CHARS + 50}
              className="max-h-32 resize-none"
            />
            <Button
              onClick={() => send(input)}
              disabled={canSend}
              aria-label="Send question to the tutor"
              className="h-10 gap-1.5"
            >
              <Send className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Ask</span>
            </Button>
          </div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Enter to ask · Shift+Enter for a new line</span>
            <span aria-live="polite">
              {input.length}/{MAX_QUESTION_CHARS}
              {input.length > MAX_QUESTION_CHARS && (
                <span className="ml-1 text-rose-600 dark:text-rose-400">
                  too long — the backend rejects over {MAX_QUESTION_CHARS} characters
                </span>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  messageIndex,
  result,
  highlightedCitation,
  teacher,
  onCitationJump,
}: {
  messageIndex: number;
  result: TutorAnswerView;
  highlightedCitation: string | null;
  teacher: boolean;
  onCitationJump: (messageIndex: number, citation: TutorCitation) => void;
}) {
  const segments = useMemo(() => parseMarkers(result.answer), [result.answer]);

  if (result.refused) {
    return (
      <div className="max-w-[92%] rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="size-4" aria-hidden="true" />
          No grounded evidence found
        </p>
        <p className="mt-1">{result.answer}</p>
        <p className="mt-1.5 text-xs opacity-80">
          The tutor answers only from validated course content. Try naming the topic
          (e.g. “moles”, “bonding”) or rephrasing the question.
        </p>
        <p className="mt-1.5 text-[11px] opacity-60">
          Deterministic refusal — no model was called.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[92%] rounded-lg border bg-muted/40 px-3 py-2.5 text-sm whitespace-pre-wrap">
        {segments.map((seg, i) =>
          seg.marker === null ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <CitationMarker
              key={i}
              marker={seg.marker}
              citationCount={result.citations.length}
              onClick={() => {
                const citation = result.citations[seg.marker! - 1];
                if (citation) onCitationJump(messageIndex, citation);
              }}
            />
          ),
        )}
      </div>

      {result.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.topics.map((topic) => (
            <Badge key={topic.code} variant="secondary" className="text-[10px] font-normal">
              {topic.code} · {topic.title}
            </Badge>
          ))}
        </div>
      )}

      {result.citations.length > 0 && (
        <div className="w-full max-w-[92%] space-y-1.5">
          <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Quote className="size-3" aria-hidden="true" />
            Sources ({result.citations.length})
          </p>
          {result.citations.map((citation) => (
            <CitationCard
              key={citation.index}
              id={`citation-${messageIndex}-${citation.index}`}
              citation={citation}
              highlighted={highlightedCitation === `citation-${messageIndex}-${citation.index}`}
              teacher={teacher}
            />
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {result.model ?? "no model"} · {result.provider} · {(result.latencyMs / 1000).toFixed(1)}s ·{" "}
        {result.evidenceCount} evidence item{result.evidenceCount === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function CitationMarker({
  marker,
  citationCount,
  onClick,
}: {
  marker: number;
  citationCount: number;
  onClick: () => void;
}) {
  if (marker < 1 || marker > citationCount) {
    // a [n] the answer text produced that has no matching citation — render as text
    return <span>[{marker}]</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Jump to source ${marker}`}
      className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-1 align-super text-[10px] font-semibold text-primary hover:bg-primary/20"
    >
      {marker}
    </button>
  );
}

function CitationCard({
  id,
  citation,
  highlighted,
  teacher,
}: {
  id: string;
  citation: TutorCitation;
  highlighted: boolean;
  teacher: boolean;
}) {
  const card = (
    <div
      id={id}
      className={
        "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors " +
        (highlighted ? "border-primary bg-primary/10" : "bg-background")
      }
    >
      <span className="flex items-center gap-2">
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
          {citation.index}
        </span>
        <span className="font-medium">{citation.label}</span>
        <span className="text-muted-foreground">{citation.sourceType}</span>
      </span>
      {teacher && citation.deepLink && (
        <a
          href={apiPath(citation.deepLink)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          title="Opens the raw source document (teacher surface)"
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          Open
        </a>
      )}
    </div>
  );

  if (teacher) return card;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="w-full cursor-default">{card}</div>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          Source links become clickable for learners with the PDF viewer surface.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
