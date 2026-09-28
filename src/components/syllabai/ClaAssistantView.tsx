"use client";

/**
 * Contextual Learning Assistant (CLA) — learner-facing panel (web slice).
 *
 * Consumes `POST /api/v1/learners/me/cla/ask` (core ClaAnswerView). The CLA
 * contract's defining difference from the free Tutor is EXPLICIT context +
 * mode (§3 "explicit, data-not-judgment"): the learner anchors the ask to a
 * validated topic (KG_TOPIC) or a servable question (PAST_PAPER_QUESTION) and
 * picks the mode; the server resolves the context fail-closed and the answer
 * arrives grounded with citations, the deterministic topic anchor, the
 * evidence count and the read-only tool trace.
 *
 * Honest behavior pinned here:
 * - The 409 `attempt_required` (the §7 answer-leakage gate) renders as
 *   guidance — "attempt first, then CHECK unlocks full feedback" — not as an
 *   error noise. It is the product working as designed.
 * - Refused answers render distinctly (the deterministic refusal path).
 * - Citation markers render as chips that jump to the reference card; both
 *   ASCII [n] and fullwidth 【n】 markers are parsed (s138: inside the
 *   markdown pipeline via a citation:// link rewrite, so chips survive
 *   bold/lists/tables; answers render as GFM markdown + KaTeX/mhchem math
 *   through the shared ChatMarkdown renderer).
 * - Model/provider/latency/evidence-count/tools are shown with every answer
 *   (research traceability, Master Spec §19) — the tools trace lists the
 *   read-only tool invocations the server made, never their raw output.
 * - The transcript lives in React state lifted to the page so it survives tab
 *   switches, exactly like the free Tutor.
 * - Look (web-bb263437, TUTOR-CLA-LOOK): the surface follows the operator's
 *   Save My Exams explain-panel reference — an amber honesty banner under the
 *   identity strip, anchor + mode as pill segments (the s129 overlay
 *   vocabulary, now shared), chat-style transcript bubbles, and the same
 *   rounded-2xl composer card as the Tutor (context pill + circular send).
 *   Presentation only — the §3 explicit-context contract, the §7 gate and the
 *   §19 footer are untouched.
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowUp,
  BookOpenCheck,
  Compass,
  FileText,
  GraduationCap,
  Lightbulb,
  ListChecks,
  Lock,
  Quote,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError, aiAskErrorMessage, api } from "@/lib/api";
import type { ClaAnswerView, ClaMode, StudentQuestionView } from "@/lib/types";
import { ChatMarkdown } from "@/components/syllabai/ChatMarkdown";

const MAX_QUESTION_CHARS = 2000; // mirrors the backend @Size(max = 2000)

export type ClaChatMessage =
  | { kind: "user"; text: string; at: number }
  | { kind: "assistant"; result: ClaAnswerView; at: number }
  | { kind: "gate"; text: string; at: number } // 409 attempt_required — guidance, not error
  | { kind: "error"; text: string; question: string; at: number };

const MODES: { value: ClaMode; label: string; hint: string; icon: typeof Lightbulb }[] = [
  { value: "EXPLAIN", label: "Explain", hint: "Teach the topic from validated sources", icon: GraduationCap },
  { value: "SUMMARIZE", label: "Summarize", hint: "Compress the whole spec structure", icon: ListChecks },
  { value: "HINT", label: "Hint", hint: "Scaffolding only — never the answer", icon: Lightbulb },
  { value: "CHECK", label: "Check", hint: "Full feedback after your attempt", icon: BookOpenCheck },
];

/** Context-kind pill vocabulary (web-bb263437) — the s129 overlay pill look,
 *  full names ride the title attribute. */
const CONTEXT_KINDS: {
  value: "KG_TOPIC" | "PAST_PAPER_QUESTION" | "QUESTION_PART" | "SMART_LESSON";
  label: string;
  title: string;
}[] = [
  { value: "KG_TOPIC", label: "Topic", title: "Topic (specification) — anchored to a validated KG topic" },
  { value: "SMART_LESSON", label: "Lesson", title: "Smart lesson — your own next action rides along" },
  { value: "PAST_PAPER_QUESTION", label: "Question", title: "Past-paper question — served through the full serving gate" },
  { value: "QUESTION_PART", label: "Part", title: "Question part — resolved on the question's current validated version" },
];

/** topic-anchored kinds share the root+topic references (KG_TOPIC, SMART_LESSON) */
function isTopicKind(kind: "KG_TOPIC" | "PAST_PAPER_QUESTION" | "QUESTION_PART" | "SMART_LESSON") {
  return kind === "KG_TOPIC" || kind === "SMART_LESSON";
}

/** The grounded answer body — GFM markdown + KaTeX math, citation chips
 *  jumping to the reference cards (shared by the assistant tab and both CLA
 *  overlays, NoteClaOverlay + QuestionClaOverlay). */
export function AnswerBody({ result }: { result: ClaAnswerView }) {
  const citationIds = useMemo(
    () => new Set(result.citations.map((c) => c.index)),
    [result],
  );
  return (
    <div className="space-y-3">
      {/* s138: the answer renders as GFM markdown + KaTeX/mhchem math; the
          [n]/【n】 markers ride the pipeline as citation:// links and come
          out through renderCitation — same chips, same anchors as before */}
      <ChatMarkdown
        renderCitation={(marker) => {
          const resolved = citationIds.has(marker);
          return (
            <a
              href={`#cla-cite-${result.context.reference}-${marker}`}
              className={
                resolved
                  ? "mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20"
                  : "mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-destructive/10 px-0.5 text-[10px] font-semibold text-destructive"
              }
              title={resolved ? "Jump to source" : "Unresolved marker"}
            >
              {marker}
            </a>
          );
        }}
      >
        {result.answer}
      </ChatMarkdown>
      {result.citations.length > 0 && (
        <div className="space-y-1.5">
          <Separator />
          {/* citation pills — the shared look (web-bb263437): same anchor ids
              and hrefs as before, so marker jumps are unchanged */}
          <div className="flex flex-wrap gap-1.5">
            {result.citations.map((c) => (
              <div
                key={c.index}
                id={`cla-cite-${result.context.reference}-${c.index}`}
                className="flex max-w-full items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40"
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {c.index}
                </span>
                <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="max-w-[14rem] truncate font-medium text-foreground">{c.label}</span>
                {c.sourceType === "MARK_SCHEME" && (
                  <Badge variant="outline" className="px-1 py-0 text-[10px]">
                    mark scheme
                  </Badge>
                )}
                {c.deepLink && c.nodeId && (
                  <a href={c.deepLink} className="shrink-0 underline hover:text-foreground" target="_blank" rel="noreferrer">
                    source
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MetaRow({ result }: { result: ClaAnswerView }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span>
        anchored <span className="font-medium text-foreground">{result.context.topicCode}</span> ·{" "}
        {result.context.topicTitle}
      </span>
      <span>
        {result.context.kind}
        {result.context.partLabel ? ` (${result.context.partLabel})` : ""} ·{" "}
        {result.context.validationState}
      </span>
      {result.context.kind === "NOTE_SECTION" && result.context.noteTitle && (
        <span>
          note:{" "}
          <span className="font-medium text-foreground">
            {result.context.noteTitle}
          </span>
        </span>
      )}
      <span>evidence {result.evidenceCount}</span>
      <span>
        {result.model ?? "deterministic"} / {result.provider}
      </span>
      <span>{(result.latencyMs / 1000).toFixed(1)}s</span>
      {(result.context.kind === "PAST_PAPER_QUESTION" ||
        result.context.kind === "QUESTION_PART") && (
        <span>
          attempted:{" "}
          <span className={result.context.attempted ? "text-foreground" : "text-amber-600"}>
            {String(result.context.attempted)}
          </span>
        </span>
      )}
      {result.context.kind === "SMART_LESSON" && result.context.lessonAction && (
        <span>
          next action:{" "}
          <span className="font-medium text-foreground">
            {result.context.lessonAction.actionType.toLowerCase().replace(/_/g, " ")}
          </span>
          {result.context.lessonAction.targetCode &&
            result.context.lessonAction.targetCode !== result.context.topicCode &&
            ` → ${result.context.lessonAction.targetCode}`}
        </span>
      )}
    </div>
  );
}

export function ClaAssistantView({
  messages,
  setMessages,
  rootId,
  topicOptions,
  defaultTopicNodeId = null,
}: {
  messages: ClaChatMessage[];
  setMessages: Dispatch<SetStateAction<ClaChatMessage[]>>;
  rootId: string | null;
  /** validated TOPIC nodes of the current subject (from the loaded graph) */
  topicOptions: { id: string; code: string; title: string }[];
  defaultTopicNodeId?: string | null;
}) {
  const [contextKind, setContextKind] = useState<
    "KG_TOPIC" | "PAST_PAPER_QUESTION" | "QUESTION_PART" | "SMART_LESSON"
  >("KG_TOPIC");
  const [topicNodeId, setTopicNodeId] = useState<string>(defaultTopicNodeId ?? "");
  const [questionId, setQuestionId] = useState<string>("");
  const [partId, setPartId] = useState<string>("");
  const [questions, setQuestions] = useState<StudentQuestionView[] | null>(null);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [mode, setMode] = useState<ClaMode>("EXPLAIN");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (defaultTopicNodeId) setTopicNodeId(defaultTopicNodeId);
  }, [defaultTopicNodeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // question + part contexts need the servable list (the SAME subject-scoped
  // surface practice uses — one subject's questions never surface under another)
  useEffect(() => {
    if (isTopicKind(contextKind) || !rootId || questions !== null) return;
    setQuestionsLoading(true);
    api
      .questions(undefined, rootId)
      .then(setQuestions)
      .catch(() => setQuestions([]))
      .finally(() => setQuestionsLoading(false));
  }, [contextKind, rootId, questions]);

  const selectedQuestion = questions?.find((q) => q.id === questionId) ?? null;
  const selectedPart =
    selectedQuestion?.parts.find((p) => p.id === partId) ?? null;

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (isTopicKind(contextKind) && !topicNodeId) return;
    if (contextKind === "PAST_PAPER_QUESTION" && !questionId) return;
    if (contextKind === "QUESTION_PART" && (!questionId || !partId)) return;

    setMessages((m) => [...m, { kind: "user", text, at: Date.now() }]);
    setDraft("");
    setBusy(true);
    try {
      const result = await api.claAsk(
        isTopicKind(contextKind)
          ? { kind: contextKind, rootId: rootId ?? undefined, topicNodeId, mode, question: text }
          : contextKind === "QUESTION_PART"
            ? { kind: contextKind, partId, mode, question: text }
            : { kind: contextKind, questionId, mode, question: text },
      );
      setMessages((m) => [...m, { kind: "assistant", result, at: Date.now() }]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // the §7 answer-leakage gate — guidance, not error
        setMessages((m) => [...m, { kind: "gate", text: e.message, at: Date.now() }]);
      } else {
        // 5xx = the backend LLM chain has no working provider — honest
        // degradation, not the opaque "an internal error occurred" (s136)
        const msg = aiAskErrorMessage(e, "Request failed");
        setMessages((m) => [...m, { kind: "error", text: msg, question: text, at: Date.now() }]);
      }
    } finally {
      setBusy(false);
    }
  };

  const disabled =
    busy ||
    !draft.trim() ||
    (isTopicKind(contextKind)
      ? !topicNodeId
      : contextKind === "QUESTION_PART"
        ? !questionId || !partId
        : !questionId);

  const selectedTopic = topicOptions.find((t) => t.id === topicNodeId) ?? null;
  const activeMode = MODES.find((m) => m.value === mode) ?? MODES[0];
  // the composer's anchor summary — one honest line for “what am I anchored to”
  const anchorSummary = isTopicKind(contextKind)
    ? selectedTopic
      ? `${selectedTopic.code} · ${selectedTopic.title}`
      : "No topic picked yet"
    : contextKind === "QUESTION_PART"
      ? selectedPart
        ? `Question ${selectedQuestion?.externalRef ?? ""} · part (${selectedPart.label})`
        : "No question part picked yet"
      : selectedQuestion
        ? `${selectedQuestion.externalRef ?? selectedQuestion.id.slice(0, 8)} · ${selectedQuestion.marks} marks`
        : "No question picked yet";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex min-h-[34rem] flex-col overflow-hidden rounded-xl border bg-background">
        {/* identity strip — the shared chat-canvas header (web-bb263437) */}
        <div className="flex items-center gap-2.5 border-b px-4 py-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground"
            aria-hidden="true"
          >
            <Sparkles className="size-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Contextual assistant</p>
            <p className="text-[11px] text-muted-foreground">
              you pick the context — it answers from validated course material
            </p>
          </div>
        </div>

        {/* amber honesty banner — the Save My Exams reference's signature */}
        <div className="flex items-start gap-2 border-b bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            The assistant can make mistakes. It answers only from validated course
            material, with citations — always check them.
          </p>
        </div>

        {/* anchor bar — the §3 explicit-context contract as pill segments +
            compact selects (the s129 overlay vocabulary, now shared) */}
        <div className="space-y-2.5 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Anchor
            </span>
            {CONTEXT_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setContextKind(k.value)}
                aria-pressed={contextKind === k.value}
                title={k.title}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  contextKind === k.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>

          {isTopicKind(contextKind) ? (
            <Select value={topicNodeId} onValueChange={setTopicNodeId}>
              <SelectTrigger
                className="h-8 w-full text-xs"
                aria-label="Anchored topic (server resolves VALIDATED-only)"
              >
                <SelectValue placeholder="Pick the topic you are studying" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {topicOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.code} — {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="space-y-1.5">
              <Select
                value={questionId}
                onValueChange={(v) => {
                  setQuestionId(v);
                  setPartId("");
                }}
              >
                <SelectTrigger
                  className="h-8 w-full text-xs"
                  aria-label="Anchored question (served through the full serving gate)"
                >
                  <SelectValue
                    placeholder={questionsLoading ? "Loading questions…" : "Pick the question you are working on"}
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(questions ?? []).map((q) => (
                    <SelectItem key={q.id} value={q.id}>
                      {(q.externalRef ?? q.id.slice(0, 8))} — {(q.stem ?? "").slice(0, 70)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedQuestion && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedQuestion.marks} marks · {selectedQuestion.type}
                  {selectedQuestion.stem ? ` · ${(selectedQuestion.stem ?? "").slice(0, 120)}` : ""}
                </p>
              )}
            </div>
          )}

          {contextKind === "QUESTION_PART" && (
            <div className="space-y-1.5">
              <Select value={partId} onValueChange={setPartId} disabled={!selectedQuestion}>
                <SelectTrigger
                  className="h-8 w-full text-xs"
                  aria-label="Anchored part (resolved on the question's CURRENT validated version)"
                >
                  <SelectValue
                    placeholder={
                      !selectedQuestion
                        ? "Pick a question first"
                        : "Pick the part you are working on"
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {(selectedQuestion?.parts ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      ({p.label}) — {(p.prompt ?? "").slice(0, 70)} · {p.marks} marks
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPart && (
                <p className="text-[11px] text-muted-foreground">
                  Part ({selectedPart.label}) · {selectedPart.marks} marks
                  {selectedPart.prompt ? ` · ${selectedPart.prompt.slice(0, 120)}` : ""}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Mode
            </span>
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  aria-pressed={mode === m.value}
                  title={m.hint}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                    mode === m.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40",
                  )}
                >
                  <Icon className="size-3" aria-hidden="true" />
                  {m.label}
                </button>
              );
            })}
            <span className="text-[11px] text-muted-foreground">{activeMode.hint}</span>
          </div>
        </div>

        {/* transcript — chat-first like the reference panel */}
        <ScrollArea className="h-[46vh] min-h-80 flex-1">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4">
          {messages.length === 0 && (
            <p className="py-6 text-center text-xs leading-relaxed text-muted-foreground">
              Every answer is grounded in validated course material anchored to the context you
              picked — citations point at the real sources, and nothing is served that the
              content does not support.
            </p>
          )}
          {messages.map((m, i) =>
            m.kind === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm">
                  {m.text}
                </div>
              </div>
            ) : m.kind === "assistant" ? (
              <Card key={i} className={m.result.refused ? "border-amber-500/40" : ""}>
                <CardContent className="space-y-2.5 pt-4">
                  {m.result.refused && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Refused — the anchored material does not support an answer to this. Try
                        rephrasing within the topic.
                      </span>
                    </div>
                  )}
                  <AnswerBody result={m.result} />
                  <Separator />
                  <MetaRow result={m.result} />
                  {m.result.tools.length > 0 && (
                    <details className="text-[11px] text-muted-foreground">
                      <summary className="flex cursor-pointer items-center gap-1 hover:text-foreground">
                        <Wrench className="h-3 w-3" /> read-only tools used ({m.result.tools.length})
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
                </CardContent>
              </Card>
            ) : m.kind === "gate" ? (
              <div
                key={i}
                className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400"
              >
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {m.text}
                  <br />
                  <span className="text-muted-foreground">
                    This is the answer-leakage gate: full feedback unlocks only after the attempt
                    exists, so hints and checks can never leak the mark scheme.
                  </span>
                </span>
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
            <p className="animate-pulse text-center text-xs text-muted-foreground">
              Resolving context → gathering validated evidence → grounding the answer…
            </p>
          )}
          <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* composer — the shared rounded-2xl card: anchor summary pill,
            borderless field, circular send (web-bb263437). The §3 contract's
            validation rides the same send() path + disabled logic as before. */}
        <div className="border-t bg-background p-3 sm:p-4">
          <div className="mx-auto w-full max-w-2xl">
            <div className="rounded-2xl border bg-background shadow-sm transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
              <div className="flex items-center px-3.5 pt-3">
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
                  <Compass className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{anchorSummary}</span>
                </span>
              </div>
              <Textarea
                id="cla-question"
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_QUESTION_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={
                  mode === "CHECK"
                    ? "Describe your answer — CHECK gives full feedback after an attempt"
                    : mode === "HINT"
                      ? "Ask for a hint (scaffolding, never the answer)"
                      : "Ask about the anchored context…"
                }
                aria-label="Your question in this context"
                rows={2}
                maxLength={MAX_QUESTION_CHARS}
                className="resize-none border-0 bg-transparent px-3.5 py-2.5 text-sm shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 focus-visible:ring-offset-0 dark:bg-transparent"
              />
              <div className="flex items-center justify-between gap-2 px-3 pb-3">
                <span className="text-[11px] text-muted-foreground">
                  Enter to ask · Shift+Enter for a new line
                </span>
                <span className="flex items-center gap-2">
                  <span aria-live="polite" className="text-[11px] tabular-nums text-muted-foreground">
                    {draft.length}/{MAX_QUESTION_CHARS}
                  </span>
                  <Button
                    onClick={() => void send()}
                    disabled={disabled}
                    aria-label="Ask the contextual assistant"
                    className="size-9 shrink-0 rounded-full"
                  >
                    {busy ? (
                      <span className="text-xs">…</span>
                    ) : (
                      <ArrowUp className="size-4" aria-hidden="true" />
                    )}
                  </Button>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
