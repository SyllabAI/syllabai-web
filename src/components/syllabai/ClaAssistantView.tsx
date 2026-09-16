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
 *   ASCII [n] and fullwidth 【n】 markers are parsed.
 * - Model/provider/latency/evidence-count/tools are shown with every answer
 *   (research traceability, Master Spec §19) — the tools trace lists the
 *   read-only tool invocations the server made, never their raw output.
 * - The transcript lives in React state lifted to the page so it survives tab
 *   switches, exactly like the free Tutor.
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  BookOpenCheck,
  GraduationCap,
  Lightbulb,
  ListChecks,
  Lock,
  Quote,
  Send,
  Wrench,
} from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { ClaAnswerView, ClaMode, StudentQuestionView } from "@/lib/types";

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

/** topic-anchored kinds share the root+topic references (KG_TOPIC, SMART_LESSON) */
function isTopicKind(kind: "KG_TOPIC" | "PAST_PAPER_QUESTION" | "QUESTION_PART" | "SMART_LESSON") {
  return kind === "KG_TOPIC" || kind === "SMART_LESSON";
}

/** Split an answer into text + citation-marker segments ([n] and 【n】). */
function parseMarkers(answer: string): { text: string; marker: number | null }[] {
  const parts: { text: string; marker: number | null }[] = [];
  const re = /[\u005B\u3010](\d+)[\u005D\u3011]/g;
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

function AnswerBody({ result }: { result: ClaAnswerView }) {
  const citationIds = useMemo(
    () => new Set(result.citations.map((c) => c.index)),
    [result],
  );
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">
        {parseMarkers(result.answer).map((seg, i) =>
          seg.marker !== null ? (
            <span key={i} className="relative">
              <a
                href={`#cla-cite-${result.context.reference}-${seg.marker}`}
                className={
                  citationIds.has(seg.marker)
                    ? "mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20"
                    : "mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-destructive/10 px-0.5 text-[10px] font-semibold text-destructive"
                }
                title={citationIds.has(seg.marker) ? "Jump to source" : "Unresolved marker"}
              >
                {seg.marker}
              </a>
            </span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>
      {result.citations.length > 0 && (
        <div className="space-y-1.5">
          <Separator />
          {result.citations.map((c) => (
            <div key={c.index} id={`cla-cite-${result.context.reference}-${c.index}`} className="flex items-start gap-2 text-xs text-muted-foreground">
              <Quote className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                <span className="font-semibold text-foreground">[{c.index}]</span> {c.label}
                {c.sourceType === "MARK_SCHEME" && (
                  <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[10px]">
                    mark scheme
                  </Badge>
                )}
                {c.deepLink && c.nodeId && (
                  <a href={c.deepLink} className="ml-1 underline hover:text-foreground" target="_blank" rel="noreferrer">
                    source
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MetaRow({ result }: { result: ClaAnswerView }) {
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
        const msg = e instanceof ApiError ? e.message : "Request failed";
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Context kind</Label>
              <Select value={contextKind} onValueChange={(v) => setContextKind(v as typeof contextKind)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KG_TOPIC">Topic (specification)</SelectItem>
                  <SelectItem value="SMART_LESSON">Smart lesson</SelectItem>
                  <SelectItem value="PAST_PAPER_QUESTION">Past-paper question</SelectItem>
                  <SelectItem value="QUESTION_PART">Question part</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as ClaMode)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label} — {m.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isTopicKind(contextKind) ? (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {contextKind === "SMART_LESSON"
                  ? "Anchored lesson topic (your own next action rides along)"
                  : "Anchored topic (server resolves VALIDATED-only)"}
              </Label>
              <Select value={topicNodeId} onValueChange={setTopicNodeId}>
                <SelectTrigger className="h-9">
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
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Anchored question (served through the full serving gate)
              </Label>
              <Select
                value={questionId}
                onValueChange={(v) => {
                  setQuestionId(v);
                  setPartId("");
                }}
              >
                <SelectTrigger className="h-9">
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
                <p className="text-xs text-muted-foreground">
                  {selectedQuestion.marks} marks · {selectedQuestion.type}
                  {selectedQuestion.stem ? ` · ${(selectedQuestion.stem ?? "").slice(0, 120)}` : ""}
                </p>
              )}
            </div>
          )}

          {contextKind === "QUESTION_PART" && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Anchored part (resolved on the question's CURRENT validated version)
              </Label>
              <Select value={partId} onValueChange={setPartId} disabled={!selectedQuestion}>
                <SelectTrigger className="h-9">
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
                <p className="text-xs text-muted-foreground">
                  Part ({selectedPart.label}) · {selectedPart.marks} marks
                  {selectedPart.prompt ? ` · ${selectedPart.prompt.slice(0, 120)}` : ""}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="cla-question" className="text-xs text-muted-foreground">
              Your question in this context
            </Label>
              <span className="text-[11px] text-muted-foreground">
                {draft.length}/{MAX_QUESTION_CHARS}
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
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void send()} disabled={disabled} className="gap-1.5">
              <Send className="h-3.5 w-3.5" /> {busy ? "Grounding…" : "Ask"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ScrollArea className="max-h-[52vh] pr-2">
        <div className="space-y-3">
          {messages.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
              Every answer is grounded in validated course material anchored to the context you
              picked — citations point at the real sources, and nothing is served that the
              content does not support.
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
    </div>
  );
}
