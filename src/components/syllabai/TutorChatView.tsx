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
 * - Working memory (s139): the transcript lives in React state lifted to the
 *   page (survives tab switches) and is sent back with each ask as a bounded
 *   `history` — the tutor answers follow-ups ("why is that?", "the second
 *   point") because retrieval is enriched with the recent turns and the
 *   prompt carries the conversation.
 * - Cross-session memory (s140, Spec §22): the first ask of a chat creates a
 *   server-side tutor session and every exchange is appended to it; a refresh
 *   (or a return visit in the same browser) hydrates the transcript from the
 *   store — "Picked up from your last conversation" — and "New chat"
 *   abandons the session (the next ask lazily creates a fresh one). The
 *   tutor also opens with grounded continuity from what the learner has
 *   already done on the topic (earlier asks, practice outcomes, reviews —
 *   see the s140 RECENT LEARNING EXPERIENCES digest, backend).
 * - A draft question can arrive from practice ("Ask tutor about this") —
 *   it only pre-fills the input; the student edits and sends it themselves.
 * - Citation deep links currently target the teacher content API / KG nodes
 *   (raw JSON surfaces). Learners see the citation as a reference card;
 *   teacher/admin users additionally get an "Open source" anchor. In-app PDF
 *   deep-linking is F-022's surface and lands later.
 * - Refusals (no grounded evidence) render distinctly — they are deterministic
 *   (provider "deterministic-refusal", no LLM call).
 * - Model/provider/latency/evidence-count are shown with every answer
 *   (research traceability, Master Spec §19). Restored (hydrated) turns keep
 *   the same footer fields; their citations stay in the research telemetry.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, ExternalLink, GraduationCap, History, MessageSquarePlus, Quote, RotateCcw, Send } from "lucide-react";
import { aiAskErrorMessage, api, apiPath, currentUser } from "@/lib/api";
import type { TutorAnswerView, TutorCitation, TutorHistoryTurn, TutorSessionTurnView } from "@/lib/types";
import { ChatMarkdown } from "@/components/syllabai/ChatMarkdown";

const MAX_QUESTION_CHARS = 2000; // mirrors the backend @Size(max = 2000)

/** Client-side working-memory cap — below the server's 12-turn re-sanitize
 *  bound, so the request always passes validation as-is. */
const MAX_HISTORY_TURNS_SENT = 8;

/** s140 §22 session store: where the current chat's server-side session id
 *  lives so a refresh (or a return visit in the same browser) can hydrate
 *  the transcript. A foreign/unknown id 404s server-side and is dropped. */
const SESSION_STORAGE_KEY = "syllabai.tutor.sessionId";

export type TutorChatMessage =
  | { kind: "user"; text: string; at: number }
  | { kind: "assistant"; result: TutorAnswerView; at: number }
  | { kind: "error"; text: string; question: string; at: number };

const SUGGESTED_QUESTIONS = [
  "Explain how to calculate moles from mass and Mr.",
  "What is the difference between ionic and covalent bonding?",
  "How do I balance a redox half-equation in acidic solution?",
];

function isTeacherLike(): boolean {
  const roles = currentUser()?.roles ?? [];
  return roles.includes("TEACHER") || roles.includes("ADMIN");
}

/**
 * The conversation as the backend's working memory wants it (s139):
 * - user turns and assistant answers (refusals included — they are honest
 *   tutor turns), error bubbles excluded (UI chrome, not conversation);
 * - the trailing user turn matching THIS question is dropped: it is the
 *   optimistic bubble of a failed ask being retried, and sending it twice
 *   would duplicate the turn in the history;
 * - capped to the most recent MAX_HISTORY_TURNS_SENT turns.
 *
 * Exported pure (module-level) so the retry/cap semantics are verifiable
 * against the real module — see scripts/s139_tutor_history_verify.ts.
 */
export function historyFor(
  messages: TutorChatMessage[],
  question: string,
): TutorHistoryTurn[] {
  const transcript = [...messages];
  for (let i = transcript.length - 1; i >= 0; i--) {
    const message = transcript[i];
    if (message.kind === "user") {
      if (message.text === question) {
        transcript.splice(i, 1);
      }
      break; // only the LAST user turn can be the retried duplicate
    }
  }
  const turns: TutorHistoryTurn[] = [];
  for (const message of transcript) {
    if (message.kind === "user") {
      turns.push({ role: "user", text: message.text });
    } else if (message.kind === "assistant") {
      turns.push({ role: "assistant", text: message.result.answer });
    }
  }
  return turns.slice(-MAX_HISTORY_TURNS_SENT);
}

/**
 * Map a stored §22 transcript turn back to the chat-message shape (s140
 * hydration). Restored assistant turns keep the honest §19 footer fields
 * (model/provider/latency/evidence count); citations are NOT reconstructed —
 * the stored prose is the learner-visible answer with markers stripped, and
 * the citation archive of record is the research telemetry.
 */
export function restoredMessage(turn: TutorSessionTurnView): TutorChatMessage {
  if (turn.role === "user") {
    return { kind: "user", text: turn.content, at: Date.parse(turn.at) };
  }
  const result: TutorAnswerView = {
    answer: turn.content,
    citations: [],
    topics: [],
    evidenceCount: turn.evidenceCount,
    model: turn.model,
    provider: turn.provider ?? "restored",
    refused: turn.refused,
    latencyMs: turn.latencyMs ?? 0,
  };
  return { kind: "assistant", result, at: Date.parse(turn.at) };
}

/** Coarse, locale-agnostic recency for the "picked up from" divider — the
 *  learner needs "how fresh", not a timestamp. */
function restoredAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 0) return " · earlier today";
  if (days === 1) return " · yesterday";
  if (days < 7) return ` · ${days} days ago`;
  return ` · ${at.toLocaleDateString()}`;
}

export function TutorChatView({
  messages,
  setMessages,
  draft = null,
  onDraftConsumed,
}: {
  messages: TutorChatMessage[];
  setMessages: Dispatch<SetStateAction<TutorChatMessage[]>>;
  /** A question pre-filled from elsewhere in the app (e.g. a wrong answer) —
   *  editable, never auto-sent. Consumed once loaded into the input. */
  draft?: string | null;
  onDraftConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [highlightedCitation, setHighlightedCitation] = useState<string | null>(null);
  // s140: shown above a hydrated transcript so "where did this come from"
  // has an honest answer
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  // In-flight guard via ref: the state flag alone is stale inside the closure
  // until re-render, so a fast double-Enter could fire two tutor calls.
  const sendingRef = useRef(false);
  // Live mirror of the transcript: send() must read the CURRENT conversation
  // (state in a closure goes stale across renders) to build the history for
  // the ask — retry buttons in particular fire with an older snapshot.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // s140 §22 session: the server-side transcript this chat appends to. null
  // = the next ask creates one (lazy — "New chat" never leaves empty rows).
  // localStorage survives refresh; a foreign id 404s server-side and drops.
  const sessionIdRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const teacher = isTeacherLike();

  // s140 refresh hydration: pick up the stored session once per mount when
  // the in-memory transcript is empty. Failures are silent by design — a
  // cleared/foreign/expired id just means a fresh chat, never an error wall.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (messagesRef.current.length > 0) return;
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return;
    let cancelled = false;
    api
      .tutorSessionGet(stored)
      .then((session) => {
        if (cancelled || session.turns.length === 0) return;
        // s141: reattach the session anchor, not just the transcript —
        // without this the next ask lazily created a NEW session and forked
        // the chat (restored turns in one session, new exchanges in another)
        sessionIdRef.current = stored;
        setMessages(session.turns.map(restoredMessage));
        setRestoredFrom(session.lastActiveAt);
      })
      .catch(() => {
        // unknown/foreign/expired — drop the stale pointer, start fresh
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        sessionIdRef.current = null;
      });
    return () => {
      cancelled = true;
    };
    // messages deliberately not in deps: hydration is a once-per-mount
    // bootstrap, not a reaction to transcript changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A draft arriving from another surface fills the input (the student stays
  // in control — they can edit or clear it before asking).
  useEffect(() => {
    if (draft) {
      setInput(draft);
      onDraftConsumed?.();
    }
  }, [draft, onDraftConsumed]);

  // keep the newest message in view
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages]);

  const inputTrimmed = input.trim();
  const canSend = sending || inputTrimmed.length === 0 || inputTrimmed.length > MAX_QUESTION_CHARS;

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || trimmed.length > MAX_QUESTION_CHARS || sendingRef.current) return;
    sendingRef.current = true;
    setInput("");
    const history = historyFor(messagesRef.current, trimmed);
    // Functional updates: append to the LIVE transcript, never rebuild from the
    // render-time snapshot — the old [...messages, ...] form dropped optimistic
    // bubbles and duplicated the user turn when retrying an error message.
    setMessages((prev) => [...prev, { kind: "user", text: trimmed, at: Date.now() }]);
    setSending(true);
    try {
      // s140: lazily create the §22 session on the first ask of a chat. A
      // failed create degrades to an unpersisted ask — the answer matters
      // more than its archival (the error surfaces on the ask itself).
      if (!sessionIdRef.current) {
        try {
          const created = await api.tutorSessionCreate();
          sessionIdRef.current = created.sessionId;
          window.localStorage.setItem(SESSION_STORAGE_KEY, created.sessionId);
        } catch {
          sessionIdRef.current = null;
        }
      }
      const result = await api.tutorAsk(trimmed, history, sessionIdRef.current);
      setMessages((prev) => [...prev, { kind: "assistant", result, at: Date.now() }]);
    } catch (err) {
      // 5xx = the backend LLM chain has no working provider — honest
      // degradation, not the opaque "an internal error occurred" (s136)
      const text = aiAskErrorMessage(
        err,
        "The tutor could not be reached. Check your connection and try again.",
      );
      setMessages((prev) => [...prev, { kind: "error", text, question: trimmed, at: Date.now() }]);
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  // "New chat": clear the in-memory transcript AND abandon the server session
  // — the next ask lazily creates a fresh one, so no empty session rows are
  // ever written. The stale localStorage pointer must go too, or a refresh
  // would resurrect the chat the learner just left.
  function newChat() {
    setMessages([]);
    setRestoredFrom(null);
    sessionIdRef.current = null;
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GraduationCap className="size-4 text-primary" aria-hidden="true" />
              <p className="text-sm font-semibold">Ask the SyllabAI tutor</p>
            </div>
            {/* s139: with working memory, starting fresh needs an explicit
                affordance — a stale conversation otherwise keeps enriching
                retrieval with off-topic turns after a topic switch. s140: it
                also abandons the §22 server session (the next ask creates a
                fresh one lazily — no empty rows). */}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={newChat}
              disabled={sending || messages.length === 0}
              aria-label="Start a new conversation (clears this chat)"
              title="Start a new conversation (clears this chat)"
            >
              <MessageSquarePlus className="size-3.5" aria-hidden="true" />
              New chat
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Grounded answers with verbatim citations from validated course content —
            mark schemes, question papers and the specification. The tutor remembers
            this conversation while you stay in it, picks up where you left off when
            you come back, and knows what you’ve already practised on a topic — so
            follow-ups like “why is that?” just work.
          </p>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-background">
        <ScrollArea className="h-[52vh] min-h-80">
          <div ref={transcriptRef} className="flex flex-col gap-4 p-4" aria-live="polite">
            {restoredFrom && messages.length > 0 && (
              <div className="flex items-center gap-1.5 self-center text-[11px] text-muted-foreground">
                <History className="size-3" aria-hidden="true" />
                Picked up from your last conversation
                {restoredAt(restoredFrom)}
              </div>
            )}
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
      {/* s138: the answer renders as GFM markdown + KaTeX/mhchem math; the
          [n] markers ride the pipeline as citation:// links and come out
          through renderCitation — same chips, same jump behavior as before */}
      <div className="max-w-[92%] rounded-lg border bg-muted/40 px-3 py-2.5">
        <ChatMarkdown
          renderCitation={(marker) => (
            <CitationMarker
              marker={marker}
              citationCount={result.citations.length}
              onClick={() => {
                const citation = result.citations[marker - 1];
                if (citation) onCitationJump(messageIndex, citation);
              }}
            />
          )}
        >
          {result.answer}
        </ChatMarkdown>
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
