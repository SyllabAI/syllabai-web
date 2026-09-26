"use client";

/**
 * Exam Questions (session-112, ADR-026; session-119 demo-parity restyle):
 * the topic/subtopic browser over the full servable SME corpus, rebuilt to
 * look and feel exactly like the syllabai-demo Learning Hub surface
 * (syllabai-demo.vercel.app — the operator's approved visual reference)
 * while keeping every production additive: real attempts (BKT fan-out,
 * evidence, telemetry, decay anchors), the confidence calibration slider,
 * Smart Mark (AI marking without scheme reveal), the policy-gated
 * reveal-and-self-mark flow, the question↔notes help panel and the mastery
 * tint in the sidebar.
 *
 * Demo anatomy ported (question-player.tsx + hub chrome):
 * - SME theme scope (.exam-theme: brand blue, Jakarta/Kodchasan type)
 * - bank index → topic "set page" navigation with breadcrumbs, two-tone
 *   display title and the exam-code pill
 * - difficulty tabs with counts + the question-number jump grid
 * - card header strip (number chip, marks, difficulty, Full screen, Save)
 * - MCQ "Choose your answer" stacked letter rows → Submit → instant
 *   verdict line + collapsible "Why this is the answer"
 * - structured "Your answer" workspaces with SME right-aligned mark
 *   placement (PartProblem)
 * - the full-screen mark-scheme modal (topic pill, part restate with Show
 *   more, your typed answers alongside, AND-joined [N mark] points) —
 *   carrying the production self-mark steppers and recording endpoint
 *
 * Marking model (operator-specified, unchanged):
 * - MCQs are deterministically marked server-side (auto-graded attempts).
 * - STRUCTURED questions: "Send" submits the attempt and reveals the mark
 *   scheme (post-attempt, demo-style free reveal) with the SME self-mark
 *   flow under it; the separate "Smart Mark" button submits and AI-marks
 *   WITHOUT revealing the scheme — feedback only — and the reveal stays
 *   available afterwards to close the loop into self-marking.
 * - Every submit flows through the same attempt endpoints as Practice, so
 *   the learner model updates identically — the integration is the reuse.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileQuestion,
  Filter,
  GraduationCap,
  Home,
  Layers,
  Lightbulb,
  ListChecks,
  Loader2,
  Lock,
  Maximize2,
  MessagesSquare,
  PenLine,
  RotateCcw,
  Send,
  Sparkles,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import {
  collectScopeFacets,
  SCOPE_ALL,
  unitMatchesScope,
  type ScopeOption,
} from "@/lib/applicability";
import {
  buildQuestionUnits,
  savedKeysOfUnit,
  unitIsAttempted,
  unitIsSaved,
  type ExamQuestionUnit,
} from "@/lib/exam-families";
import { QuestionClaOverlay } from "@/components/syllabai/QuestionClaOverlay";
import type { ClaChatMessage } from "@/components/syllabai/ClaAssistantView";
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
import { cn } from "@/lib/utils";
import { MarksStepper } from "./MarksStepper";
import { PartProblem } from "./PartProblem";
import { QuestionHelpPanel } from "./QuestionHelpPanel";
import { QuestionMarkdown } from "./QuestionMarkdown";
import { SmartMarkPanel } from "./SmartMarkPanel";

const CONFIDENCE_LABELS = ["", "guessing", "unsure", "getting there", "confident", "certain"];

const bandDot: Record<string, string> = {
  LOW: "bg-rose-500",
  DEVELOPING: "bg-amber-500",
  SECURE: "bg-emerald-500",
};

/** SME difficulty bands (demo parity): the corpus carries 1–5; SME labels
 * questions easy / medium / hard — 1–2 easy, 3 medium, 4–5 hard. */
type DifficultyBand = "easy" | "medium" | "hard";
const DIFFICULTIES = ["all", "easy", "medium", "hard"] as const;
type DifficultyFilter = (typeof DIFFICULTIES)[number];

function bandOf(difficulty: number): DifficultyBand {
  if (difficulty <= 2) return "easy";
  if (difficulty <= 3) return "medium";
  return "hard";
}

/**
 * Saved questions ride localStorage (demo parity — a bookmark affordance,
 * not canonical state; the real attempt history stays server-side). Exposed
 * as a tiny external store so components subscribe with
 * useSyncExternalStore: SSR renders the empty set, the client hydrates from
 * localStorage without a setState-in-effect, and every toggle re-renders all
 * subscribers synchronously (Save button ⇄ Saved filter stay in step).
 */
const SAVED_KEY = "syllabai.exam.saved.v1";

function loadSaved(): Set<string> {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

let savedCache: Set<string> | null = null;
const savedListeners = new Set<() => void>();

function savedSnapshot(): Set<string> {
  if (savedCache === null) savedCache = loadSaved();
  return savedCache;
}

function subscribeSaved(notify: () => void) {
  savedListeners.add(notify);
  return () => {
    savedListeners.delete(notify);
  };
}

const EMPTY_SAVED: Set<string> = new Set();

/** stable empty transcript (s129) — avoids re-rendering the overlay with a
 *  fresh [] identity when a question has no CLA history yet */
const EMPTY_CLA_MESSAGES: ClaChatMessage[] = [];

/** Save/unsave a whole family: the family key plus every member row id (so
 * bookmarks stored per-row before families existed — session-119 — keep
 * resolving, and un-saving clears them all). */
function setSavedMembership(keys: string[], member: boolean) {
  const next = new Set(savedSnapshot());
  for (const k of keys) {
    if (member) next.add(k);
    else next.delete(k);
  }
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify([...next]));
  } catch {
    /* private mode etc. — saving is best-effort */
  }
  savedCache = next;
  savedListeners.forEach((l) => l());
}

// ── the view: sidebar tree + bank index / topic set page ─────────────────

export function ExamQuestionsView({
  rootId,
  graph,
  history,
  subjectName,
  onAttemptSubmitted,
  onAskTutorAbout,
  claTranscripts,
  setClaTranscripts,
}: {
  /** the subject's KG root — scopes the taxonomy and the question lists */
  rootId: string | null;
  /** the personalized graph already loaded by the workbench — mastery tint */
  graph: LearnerKnowledgeGraphView | null;
  /** recent attempts (already loaded) — the "tried" affordance on cards */
  history: AttemptHistoryView | null;
  /** workbench subject label for the demo-parity header (e.g. "Chemistry") */
  subjectName?: string | null;
  onAttemptSubmitted: () => void;
  onAskTutorAbout?: (draft: string) => void;
  /** per-question CLA transcripts (s129) — lifted to the page so they survive
   *  tab switches, keyed by the whole-question family key */
  claTranscripts: Record<string, ClaChatMessage[]>;
  setClaTranscripts: Dispatch<SetStateAction<Record<string, ClaChatMessage[]>>>;
}) {
  const [taxonomy, setTaxonomy] = useState<QuestionTopicTaxonomyView | null>(null);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  /** the rootId the current taxonomy/error belongs to — staleness is derived
      in render instead of resetting state inside effects (lint-clean) */
  const [taxonomyRoot, setTaxonomyRoot] = useState<string | null | undefined>(undefined);
  const [selected, setSelected] = useState<QuestionTaxonomyTopic | null>(null);
  const [questions, setQuestions] = useState<StudentQuestionView[] | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  /** the topic nodeId the current questions/error belong to */
  const [questionsTopic, setQuestionsTopic] = useState<string | null>(null);
  const savedIds = useSyncExternalStore(subscribeSaved, savedSnapshot, () => EMPTY_SAVED);
  const [savedOnly, setSavedOnly] = useState(false);

  /** the open CLA overlay's anchor (s129): the whole question (unit) + the
   *  part its Approach card is aimed at (a box/row id, null = first target).
   *  Captured at open — scrolling the page behind the drawer can never
   *  silently change the anchor. */
  const [claFor, setClaFor] = useState<{
    unit: ExamQuestionUnit;
    index: number;
    targetId: string | null;
  } | null>(null);

  /** bookmarks operate on whole questions (families), session-120 */
  const toggleSavedUnit = useCallback(
    (unit: ExamQuestionUnit) => {
      const keys = savedKeysOfUnit(unit);
      const member = keys.some((k) => savedIds.has(k));
      setSavedMembership(keys, !member);
    },
    [savedIds],
  );

  // node id -> this learner's mastery state (the sidebar tint)
  const masteryByNode = useMemo(() => {
    const map = new Map<string, LearnerNodeWithStateView>();
    for (const node of graph?.nodes ?? []) {
      map.set(node.id, node);
    }
    return map;
  }, [graph]);

  /** open the question-anchored CLA overlay (s129): header button passes null
   *  (default target), a part's lightbulb passes that part's id */
  const openCla = useCallback(
    (unit: ExamQuestionUnit, index: number, targetId: string | null) =>
      setClaFor({ unit, index, targetId }),
    [],
  );

  const attemptedQuestionIds = useMemo(
    () => new Set((history?.attempts ?? []).map((a) => a.questionId)),
    [history],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const view = await api.questionTaxonomy(rootId ?? undefined);
        if (!cancelled) {
          setTaxonomy(view);
          setTaxonomyRoot(rootId ?? undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setTaxonomyError(
            err instanceof Error ? err.message : "Failed to load the question topics",
          );
          setTaxonomyRoot(rootId ?? undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await api.questions(selected.nodeId);
        if (!cancelled) {
          setQuestions(list);
          setQuestionsTopic(selected.nodeId);
        }
      } catch (err) {
        if (!cancelled) {
          setQuestionsError(
            err instanceof Error ? err.message : "Failed to load the questions",
          );
          setQuestionsTopic(selected.nodeId);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  // derived staleness (render-phase, no effect resets): a taxonomy/selection
  // from another subject root or topic must not flash while its reload is in
  // flight — the guards below show skeletons until fresh data lands
  const activeRoot = rootId ?? undefined;
  const taxonomyFresh = taxonomyRoot === activeRoot;
  const activeSelected =
    selected && taxonomy && taxonomyFresh
      ? taxonomy.sections.some((s) => s.topics.some((t) => t.nodeId === selected.nodeId))
        ? selected
        : null
      : null;
  const questionsFresh = !!activeSelected && questionsTopic === activeSelected.nodeId;

  if (taxonomyError && taxonomyFresh) {
    return (
      <div className="exam-theme">
        <Alert variant="destructive">
          <AlertTitle>Exam questions unavailable</AlertTitle>
          <AlertDescription>{taxonomyError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!taxonomy || !taxonomyFresh) {
    return (
      <div className="exam-theme space-y-3">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-5 w-full max-w-xl" />
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const allTopics = taxonomy.sections.flatMap((s) => s.topics);
  if (allTopics.length === 0) {
    return (
      <div className="exam-theme">
        <Alert>
          <AlertTitle>No validated questions yet</AlertTitle>
          <AlertDescription>
            Questions appear here once validated content covers a topic — the same
            serving gate every learner surface uses.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // demo chrome: exam code from the corpus's own code prefix (e.g. 4CH1-S1-f)
  const examCode = allTopics[0]?.code.split("-")[0] ?? null;
  const subject = subjectName?.trim() || "Chemistry";

  return (
    <div className="exam-theme space-y-5">
      <header className="space-y-3">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-1 text-[13px]"
        >
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="inline-flex items-center gap-1 py-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Home className="size-3.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Home</span>
          </button>
          <span aria-hidden className="text-muted-foreground/80">/</span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn(
              "py-1 underline-offset-2 transition-colors hover:text-foreground hover:underline",
              activeSelected ? "text-muted-foreground" : "font-medium text-foreground",
            )}
          >
            Exam Questions
          </button>
          {activeSelected && (
            <>
              <span aria-hidden className="text-muted-foreground/80">/</span>
              <span className="py-1 font-medium text-foreground">{activeSelected.title}</span>
            </>
          )}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="exam-display max-w-2xl text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            {activeSelected ? (
              <>
                {activeSelected.title}
                <span className="text-muted-foreground">
                  {" "}
                  (Edexcel International GCSE {subject}): Exam Questions
                </span>
              </>
            ) : (
              <>
                Edexcel International GCSE {subject}{" "}
                <span className="text-muted-foreground">Exam Questions By Topic</span>
              </>
            )}
          </h1>
          {examCode && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/50 px-3 py-1.5 text-[13px]">
              <span className="font-semibold text-foreground">Exam code:</span>
              <span className="font-mono text-muted-foreground">{examCode}</span>
            </span>
          )}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
          {activeSelected
            ? "Answer inline, self-mark against the mark scheme, or let Smart Mark give you feedback without giving the scheme away."
            : `Exam-style questions organised by topic — ${taxonomy.totalDistinctQuestions} questions across ${allTopics.length} topics, with parts, command words, mark schemes and self-marking.`}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
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
          {taxonomy.sections.map((section) => {
            const numMatch = section.code.match(/S(\d+)$/);
            return (
              <div key={section.nodeId} className="rounded-lg border bg-background">
                <p className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="min-w-0 truncate">
                    {numMatch ? <><span className="font-semibold">{numMatch[1]}.</span> {section.title}</> : section.title}
                  </span>
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
                          onClick={() => setSelected(isActive ? null : topic)}
                          aria-current={isActive ? "true" : undefined}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                            isActive
                              ? "bg-primary/10 font-medium text-primary ring-1 ring-primary/30"
                              : "hover:bg-muted/60",
                          )}
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
            );
          })}
        </aside>

        <div className="min-w-0">
          {activeSelected ? (
            <TopicPane
              topic={activeSelected}
              questions={questionsFresh ? questions : null}
              questionsError={questionsFresh ? questionsError : null}
              attemptedQuestionIds={attemptedQuestionIds}
              savedIds={savedIds}
              savedOnly={savedOnly}
              onToggleSavedOnly={() => setSavedOnly((v) => !v)}
              onToggleSaved={toggleSavedUnit}
              onAttemptSubmitted={onAttemptSubmitted}
              onAskTutorAbout={onAskTutorAbout}
              onAskCla={openCla}
            />
          ) : (
            <BankIndex
              taxonomy={taxonomy}
              onSelect={setSelected}
              attemptedQuestionIds={attemptedQuestionIds}
            />
          )}
        </div>
      </div>

      {/* the question-anchored CLA overlay (s129) — ONE instance for the whole
          browser; the anchor is captured at open and the transcript is per
          whole question (lifted to the page, survives tab switches) */}
      <QuestionClaOverlay
        open={claFor !== null}
        onOpenChange={(o) => {
          if (!o) setClaFor(null);
        }}
        rootId={rootId}
        unit={claFor?.unit ?? null}
        questionNumber={claFor ? claFor.index + 1 : null}
        initialTargetId={claFor?.targetId ?? null}
        messages={claFor ? (claTranscripts[claFor.unit.key] ?? EMPTY_CLA_MESSAGES) : EMPTY_CLA_MESSAGES}
        setMessages={(update) => {
          if (!claFor) return;
          const key = claFor.unit.key;
          setClaTranscripts((prev) => {
            const current = prev[key] ?? [];
            const next = typeof update === "function" ? update(current) : update;
            return { ...prev, [key]: next };
          });
        }}
      />
    </div>
  );
}

// ── bank index (demo /exam-questions landing): topics grouped by section ──

function BankIndex({
  taxonomy,
  onSelect,
  attemptedQuestionIds,
}: {
  taxonomy: QuestionTopicTaxonomyView;
  onSelect: (topic: QuestionTaxonomyTopic) => void;
  attemptedQuestionIds: Set<string>;
}) {
  return (
    <div className="space-y-5">
      {taxonomy.sections.map((section) => {
        const numMatch = section.code.match(/S(\d+)$/);
        return (
          <section key={section.nodeId} aria-label={`Topic ${numMatch?.[1] ?? ""}: ${section.title}`}>
            <div className="mb-2 flex items-center gap-2">
              <span
                className="size-4 shrink-0 rounded-full border-2 border-muted-foreground/25"
                aria-hidden
              />
              <h2 className="text-[15px] font-semibold">
                {numMatch ? <><span className="font-semibold">{numMatch[1]}.</span> {section.title}</> : section.title}
              </h2>
            </div>
            <div className="ml-4 grid gap-2 border-l pl-3 sm:grid-cols-2">
              {section.topics.map((topic) => (
                <button
                  key={topic.nodeId}
                  type="button"
                  onClick={() => onSelect(topic)}
                  className="group flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40"
                >
                  <FileQuestion className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug group-hover:text-primary">
                      {topic.title}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {topic.questionCount} questions
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {topic.mcqCount} multiple choice
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {topic.structuredCount} structured
                      </Badge>
                    </span>
                  </span>
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── topic set page (demo [topicSlug] page): tabs, jump grid, questions ────

function TopicPane({
  topic,
  questions,
  questionsError,
  attemptedQuestionIds,
  savedIds,
  savedOnly,
  onToggleSavedOnly,
  onToggleSaved,
  onAttemptSubmitted,
  onAskTutorAbout,
  onAskCla,
}: {
  topic: QuestionTaxonomyTopic;
  questions: StudentQuestionView[] | null;
  questionsError: string | null;
  attemptedQuestionIds: Set<string>;
  savedIds: Set<string>;
  savedOnly: boolean;
  onToggleSavedOnly: () => void;
  onToggleSaved: (unit: ExamQuestionUnit) => void;
  onAttemptSubmitted: () => void;
  onAskTutorAbout?: (draft: string) => void;
  /** open the question-anchored CLA overlay (s129) — unit + display index +
   *  optional pre-aimed part target */
  onAskCla: (unit: ExamQuestionUnit, index: number, targetId: string | null) => void;
}) {
  const [difficulty, setDifficulty] = useState<DifficultyFilter>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "mcq" | "structured">("all");

  // official paper/unit/tier scope (T-C25): the applicability core serves
  // inline on each spec-point mapping (T-C24/V39), so the loaded topic's
  // questions scope with zero extra requests. Picks belong to the topic they
  // were made on — switching topics resets them (render-phase derivation,
  // the house staleness pattern; no effect resets).
  const [scope, setScope] = useState<{
    topicId: string;
    paper: string;
    unit: string;
    tier: string;
  } | null>(null);
  const activeScope =
    scope && scope.topicId === topic.nodeId
      ? scope
      : { topicId: topic.nodeId, paper: SCOPE_ALL, unit: SCOPE_ALL, tier: SCOPE_ALL };
  const setScopeDim = (dim: "paper" | "unit" | "tier", value: string) =>
    setScope({ ...activeScope, topicId: topic.nodeId, [dim]: value });

  // whole questions (families), SME page order — the demo's serving unit
  const units = useMemo(
    () => buildQuestionUnits(questions ?? []),
    [questions],
  );

  const scopeFacets = useMemo(() => collectScopeFacets(units), [units]);
  const scopeActive =
    activeScope.paper !== SCOPE_ALL ||
    activeScope.unit !== SCOPE_ALL ||
    activeScope.tier !== SCOPE_ALL;

  const counts = useMemo(() => {
    const c: Record<DifficultyFilter, number> = {
      all: units.length,
      easy: 0,
      medium: 0,
      hard: 0,
    };
    for (const u of units) c[bandOf(u.difficulty)] += 1;
    return c;
  }, [units]);

  const visible = useMemo(() => {
    let list = units;
    if (scopeActive) {
      list = list.filter((u) =>
        unitMatchesScope(u, activeScope.paper, activeScope.unit, activeScope.tier),
      );
    }
    if (difficulty !== "all") list = list.filter((u) => bandOf(u.difficulty) === difficulty);
    if (typeFilter === "mcq") list = list.filter((u) => u.type === "mcq");
    if (typeFilter === "structured") list = list.filter((u) => u.type === "structured");
    if (savedOnly) list = list.filter((u) => unitIsSaved(u, savedIds));
    return list;
  }, [
    units,
    scopeActive,
    activeScope.paper,
    activeScope.unit,
    activeScope.tier,
    difficulty,
    typeFilter,
    savedOnly,
    savedIds,
  ]);

  const isAttempted = (unit: ExamQuestionUnit) => unitIsAttempted(unit, attemptedQuestionIds);

  // demo renderSelect/renderLocked ported verbatim (specification explorer) —
  // only the locked fact's noun changes: a topic's unit of display is the
  // whole question, not the printed statement
  const renderScopeSelect = (
    dim: "paper" | "unit" | "tier",
    icon: ReactNode,
    labelText: string,
    value: string,
    options: ScopeOption[],
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {labelText}
      </Label>
      <Select value={value} onValueChange={(v) => setScopeDim(dim, v)}>
        <SelectTrigger className="h-9 w-full min-w-36" aria-label={labelText}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SCOPE_ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const renderScopeLocked = (
    key: string,
    icon: ReactNode,
    labelText: string,
    value: string,
  ) => (
    <div key={key} className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {labelText}
      </Label>
      <div className="flex h-9 items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        <span>Every question · {value}</span>
      </div>
    </div>
  );

  const scrollTo = (key: string) => {
    document.getElementById(`q-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const totalMarks = units.reduce((a, u) => a + u.marks, 0);
  // SME-style duration estimate (demo set page: "2 hours · 23 questions")
  const estTime =
    totalMarks >= 80
      ? `≈ ${Math.round(totalMarks / 60)} hours`
      : `≈ ${Math.max(totalMarks, 1)} min`;

  return (
    <div className="space-y-5">
      {/* slim meta line (demo: "23 questions · 130 marks · ≈ 2 hours") —
          whole questions: a family's parts share one card and its marks sum */}
      <p className="text-sm text-muted-foreground">
        {questions
          ? `${units.length} questions · ${totalMarks} marks · ${estTime}`
          : `${topic.questionCount} questions (${topic.mcqCount} multiple choice · ${topic.structuredCount} structured)`}
      </p>

      {/* difficulty tabs (demo controls, research §6.2) + saved filter */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={difficulty === d}
              onClick={() => setDifficulty(d)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition-colors",
                difficulty === d
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {d === "all" ? "All" : d}
              <span className="ml-1.5 text-[11px] tabular-nums opacity-70">{counts[d]}</span>
            </button>
          ))}
        </div>
        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label="Question type"
        >
          {(
            [
              ["all", "All types"],
              ["mcq", "Multiple choice"],
              ["structured", "Structured"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={typeFilter === value}
              onClick={() => setTypeFilter(value)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                typeFilter === value
                  ? "border-primary/40 bg-primary/5 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant={savedOnly ? "default" : "outline"}
          className="ml-auto h-8 gap-1.5 px-2.5 text-xs"
          onClick={onToggleSavedOnly}
          aria-pressed={savedOnly}
        >
          <Bookmark className="size-3.5" aria-hidden />
          Saved ({[...savedIds].length})
        </Button>
      </div>

      {/* official scope controls (T-C25, demo honest-controls parity): the
          facets are the canonical applicability core serves inline — nothing
          is derived; a dimension appears as a select only when the topic's
          questions actually carry >=2 of its values, as a locked fact at
          exactly one, and never when unscoped (footnote instead) */}
      {questions &&
        (scopeFacets.paperOptions.length +
          scopeFacets.unitOptions.length +
          scopeFacets.tierOptions.length >
        0 ? (
          <div className="rounded-lg border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Filter className="size-3.5 text-muted-foreground" aria-hidden />
                Scope by the official assessment structure
              </p>
              {scopeActive && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {visible.length} / {units.length} shown
                </Badge>
              )}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {scopeFacets.paperOptions.length >= 2 &&
                renderScopeSelect(
                  "paper",
                  <ListChecks className="size-3.5" aria-hidden />,
                  "Paper",
                  activeScope.paper,
                  scopeFacets.paperOptions,
                )}
              {scopeFacets.paperOptions.length === 1 &&
                renderScopeLocked(
                  "lk-paper",
                  <ListChecks className="size-3.5" aria-hidden />,
                  "Paper",
                  scopeFacets.paperOptions[0].label,
                )}
              {scopeFacets.unitOptions.length >= 2 &&
                renderScopeSelect(
                  "unit",
                  <Layers className="size-3.5" aria-hidden />,
                  "Unit",
                  activeScope.unit,
                  scopeFacets.unitOptions,
                )}
              {scopeFacets.unitOptions.length === 1 &&
                renderScopeLocked(
                  "lk-unit",
                  <Layers className="size-3.5" aria-hidden />,
                  "Unit",
                  scopeFacets.unitOptions[0].label,
                )}
              {scopeFacets.tierOptions.length >= 2 &&
                renderScopeSelect(
                  "tier",
                  <GraduationCap className="size-3.5" aria-hidden />,
                  "Tier",
                  activeScope.tier,
                  scopeFacets.tierOptions,
                )}
              {scopeFacets.tierOptions.length === 1 &&
                renderScopeLocked(
                  "lk-tier",
                  <GraduationCap className="size-3.5" aria-hidden />,
                  "Tier",
                  scopeFacets.tierOptions[0].label,
                )}
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Assessment homes come from the parsed Pearson specification and
              ride on each question's spec-point mapping — official data, never
              inferred. Filters appear only where the qualification has that
              structure: a linear IGCSE has no unit scope, and only Maths A
              splits Foundation / Higher tiers.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Official paper/unit scope has not reached this topic's questions yet
            — every question below is shown unscoped.
          </p>
        ))}

      {/* question number grid (demo jump-to-question) — whole questions */}
      {visible.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Jump to question">
          {visible.map((unit, i) => (
            <button
              key={unit.key}
              type="button"
              onClick={() => scrollTo(unit.key)}
              aria-label={`Question ${i + 1}${isAttempted(unit) ? " (attempted)" : ""}`}
              className={cn(
                "flex size-9 items-center justify-center rounded-md border text-[13px] font-medium transition-colors",
                isAttempted(unit)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:border-primary/50 hover:text-primary",
              )}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* questions */}
      <div className="space-y-4">
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
          <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No validated questions are linked to this topic yet.
          </p>
        )}

        {questions && questions.length > 0 && visible.length === 0 && (
          <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            No {difficulty !== "all" ? difficulty : ""}
            {savedOnly ? " saved" : ""}
            {typeFilter !== "all" ? ` ${typeFilter === "mcq" ? "multiple-choice" : "structured"}` : ""}
            {" "}questions
            {scopeActive ? " under the selected paper/unit/tier scope" : ""} in
            this topic.
          </p>
        )}

        {visible.map((unit, i) => (
          <ExamQuestionCard
            key={unit.key}
            unit={unit}
            index={i}
            attempted={isAttempted(unit)}
            saved={unitIsSaved(unit, savedIds)}
            onToggleSaved={() => onToggleSaved(unit)}
            onAttemptSubmitted={onAttemptSubmitted}
            onAskTutorAbout={onAskTutorAbout}
            onAskCla={(targetId) => onAskCla(unit, i, targetId)}
          />
        ))}
      </div>
    </div>
  );
}

// ── one question card: demo anatomy header + the production answer flow ───

function ExamQuestionCard({
  unit,
  index,
  attempted,
  saved,
  onToggleSaved,
  onAttemptSubmitted,
  onAskTutorAbout,
  onAskCla,
}: {
  unit: ExamQuestionUnit;
  index: number;
  attempted: boolean;
  saved: boolean;
  onToggleSaved: () => void;
  onAttemptSubmitted: () => void;
  onAskTutorAbout?: (draft: string) => void;
  /** open the CLA overlay (s129): null = whole question (Understand default);
   *  a part id pre-aims Approach at that part */
  onAskCla: (targetId: string | null) => void;
}) {
  const [fullFor, setFullFor] = useState(false);

  return (
    <article
      id={`q-${unit.key}`}
      className="scroll-mt-24 rounded-xl border bg-card"
    >
      {/* demo header strip: number chip · marks · difficulty · tried · actions.
          A family's marks are the SME question's total (parts sum). */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span className="rounded-md bg-muted px-2 py-0.5 text-[13px] font-semibold">
          {index + 1}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {unit.marks} mark{unit.marks === 1 ? "" : "s"}
        </Badge>
        <Badge variant="secondary" className="text-[10px] capitalize">
          {bandOf(unit.difficulty)}
        </Badge>
        {attempted && (
          <Badge
            variant="outline"
            className="border-emerald-700/30 text-[10px] text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-400"
          >
            <CheckCircle2 className="mr-0.5 size-3" aria-hidden /> attempted
          </Badge>
        )}
        {unit.ref ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {unit.ref}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => onAskCla(null)}
            aria-haspopup="dialog"
            title="Ask the contextual assistant about this question"
          >
            <Sparkles className="size-3.5 text-primary" aria-hidden /> Ask CLA
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={() => setFullFor(true)}
          >
            <Maximize2 className="size-3.5" aria-hidden /> Full screen
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs"
            onClick={onToggleSaved}
            aria-pressed={saved}
          >
            {saved ? (
              <>
                <BookmarkCheck className="size-3.5 text-primary" aria-hidden /> Saved
              </>
            ) : (
              <>
                <Bookmark className="size-3.5" aria-hidden /> Save
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* ONE stateful body instance renders both the inline card and the
            full-screen dialog — drafts and results persist across the toggle */}
        <UnitBody
          unit={unit}
          index={index}
          fullScreen={fullFor}
          onFullScreenChange={setFullFor}
          onAttemptSubmitted={onAttemptSubmitted}
          onAskTutorAbout={onAskTutorAbout}
          onAskClaPart={onAskCla}
        />
      </div>
    </article>
  );
}

// ── question body (shared by the list card + the full-screen dialog) ──────

/** Per-row answer-flow state. Hoisted into UnitBody so the inline card and
 *  the full-screen dialog bind ONE state (drafts persist across the toggle,
 *  the session-119 contract) — now per member row of a family, so every part
 *  keeps its own attempt, confidence and response-time anchor. */
type PartFlow = {
  chosen: string | null;
  mcqResult: AttemptResultView | null;
  partAnswers: Record<string, string>;
  attempt: StructuredAttemptResultView | null;
  mode: "reveal" | "smart" | null;
  busy: boolean;
  error: string | null;
  confidence: number;
  startedAt: number | null;
  schemeOpen: boolean;
};

const EMPTY_FLOW: PartFlow = {
  chosen: null,
  mcqResult: null,
  partAnswers: {},
  attempt: null,
  mode: null,
  busy: false,
  error: null,
  confidence: 3,
  startedAt: null,
  schemeOpen: false,
};

function UnitBody({
  unit,
  index,
  fullScreen,
  onFullScreenChange,
  onAttemptSubmitted,
  onAskTutorAbout,
  onAskClaPart,
}: {
  unit: ExamQuestionUnit;
  index: number;
  fullScreen: boolean;
  onFullScreenChange: (open: boolean) => void;
  onAttemptSubmitted: () => void;
  onAskTutorAbout?: (draft: string) => void;
  /** per-part CLA entry (s129): opens the overlay with Approach aimed at the
   *  given box/row id — threaded to every answer box's lightbulb */
  onAskClaPart?: (targetId: string) => void;
}) {
  const [flows, setFlows] = useState<Record<string, PartFlow>>({});

  const flowOf = (partId: string): PartFlow => flows[partId] ?? EMPTY_FLOW;
  const patchFlow = (partId: string, patch: Partial<PartFlow>) => {
    setFlows((prev) => ({
      ...prev,
      [partId]: { ...(prev[partId] ?? EMPTY_FLOW), ...patch },
    }));
  };

  // responseTimeMs research anchor: the first interaction with THIS part,
  // not the topic load (browsing time must not pollute response time)
  const anchor = (partId: string) => {
    setFlows((prev) => {
      const f = prev[partId] ?? EMPTY_FLOW;
      if (f.startedAt !== null) return prev;
      return { ...prev, [partId]: { ...f, startedAt: Date.now() } };
    });
  };
  const elapsed = (partId: string) => {
    const started = flowOf(partId).startedAt;
    return started === null ? 0 : Date.now() - started;
  };

  const resetPart = (partId: string) => {
    setFlows((prev) => ({ ...prev, [partId]: { ...EMPTY_FLOW } }));
  };

  async function submitMcq(part: StudentQuestionView) {
    const flow = flowOf(part.id);
    if (!flow.chosen || flow.busy) return;
    patchFlow(part.id, { busy: true, error: null });
    try {
      const result = await api.submitAttempt({
        questionId: part.id,
        chosenOptionId: flow.chosen,
        responseTimeMs: elapsed(part.id),
        confidence: flow.confidence,
        selfDoubtFlag: false,
        timedCondition: false,
      });
      patchFlow(part.id, { mcqResult: result, busy: false });
      onAttemptSubmitted();
    } catch (err) {
      patchFlow(part.id, {
        busy: false,
        error: err instanceof Error ? err.message : "Failed to submit the attempt",
      });
    }
  }

  async function submitStructured(
    part: StudentQuestionView,
  ): Promise<StructuredAttemptResultView | null> {
    const flow = flowOf(part.id);
    const partViews = part.parts ?? [];
    const allAnswered = partViews.every(
      (p) => (flow.partAnswers[p.id] ?? "").trim().length > 0,
    );
    if (!allAnswered || flow.busy) return null;
    patchFlow(part.id, { busy: true, error: null });
    try {
      const response = await api.submitStructuredAttempt({
        questionId: part.id,
        partAnswers: partViews.map((p) => ({
          partId: p.id,
          answerText: flow.partAnswers[p.id] ?? "",
        })),
        responseTimeMs: elapsed(part.id),
        confidence: flow.confidence,
        selfDoubtFlag: false,
        timedCondition: false,
      });
      patchFlow(part.id, { attempt: response, busy: false });
      onAttemptSubmitted();
      return response;
    } catch (err) {
      patchFlow(part.id, {
        busy: false,
        error: err instanceof Error ? err.message : "Failed to submit the attempt",
      });
      return null;
    }
  }

  // ONE content tree shared by the inline card and the full-screen dialog
  // (demo parity): a whole question — every member row in SME order, the
  // first part carrying the shared stimulus (the demo's part stacking).
  const content = (
    <div className="space-y-5">
      {unit.multi ? <QuestionHelpPanel question={unit.parts[0]} /> : null}
      {unit.parts.map((part, i) => (
        <div
          key={part.id}
          className={cn(unit.multi && i > 0 && "space-y-5 border-t pt-5")}
        >
          <PartFlowSection
            part={part}
            showHelp={!unit.multi}
            flow={flowOf(part.id)}
            onPatch={(patch) => patchFlow(part.id, patch)}
            onFirstTouch={() => anchor(part.id)}
            onSubmitMcq={() => submitMcq(part)}
            onSend={async () => {
              const response = await submitStructured(part);
              if (response) patchFlow(part.id, { mode: "reveal", schemeOpen: true });
            }}
            onSmartMark={async () => {
              const response = await submitStructured(part);
              if (response) patchFlow(part.id, { mode: "smart" });
            }}
            onRetry={() => resetPart(part.id)}
            onSetSchemeOpen={(open) => patchFlow(part.id, { schemeOpen: open })}
            onAskTutorAbout={onAskTutorAbout}
            onAskClaPart={onAskClaPart}
          />
        </div>
      ))}
    </div>
  );

  return (
    <>
      {content}

      {/* full-screen question (demo Dialog) — same content instance */}
      <Dialog open={fullScreen} onOpenChange={onFullScreenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="exam-theme max-h-[90vh] max-w-3xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              Question {index + 1}
              <Badge variant="outline" className="text-[10px]">
                {unit.marks} marks
              </Badge>
              {unit.multi && unit.parts.length > 1 && (
                <span className="text-xs font-normal text-muted-foreground">
                  {unit.parts.length} parts
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {content}
        </DialogContent>
      </Dialog>

      {/* the demo full-screen mark-scheme modal, carrying the production
          reveal-and-self-mark flow (steppers + recording endpoint).
          Conditionally mounted per part: each open is a fresh, lint-clean
          state machine (loading → open/withheld/error → recorded) keyed by
          the attempt, so no effect ever resets state synchronously. */}
      {unit.parts.map((part) => {
        const flow = flowOf(part.id);
        return part.type === "STRUCTURED" && flow.attempt && flow.schemeOpen ? (
          <MarkSchemeDialog
            key={flow.attempt.attemptId}
            question={part}
            attempt={flow.attempt}
            partAnswers={flow.partAnswers}
            onClose={() => patchFlow(part.id, { schemeOpen: false })}
            onDone={() => resetPart(part.id)}
          />
        ) : null;
      })}
    </>
  );
}

// ── one member row's answer flow (MCQ or structured), fully controlled ────

function PartFlowSection({
  part,
  showHelp,
  flow,
  onPatch,
  onFirstTouch,
  onSubmitMcq,
  onSend,
  onSmartMark,
  onRetry,
  onSetSchemeOpen,
  onAskTutorAbout,
  onAskClaPart,
}: {
  part: StudentQuestionView;
  /** single-row questions keep the help panel in its session-119 position
   *  (after the stem); families render one panel above all parts */
  showHelp: boolean;
  flow: PartFlow;
  onPatch: (patch: Partial<PartFlow>) => void;
  onFirstTouch: () => void;
  onSubmitMcq: () => void;
  onSend: () => void;
  onSmartMark: () => void;
  onRetry: () => void;
  onSetSchemeOpen: (open: boolean) => void;
  onAskTutorAbout?: (draft: string) => void;
  /** per-part CLA entry (s129) */
  onAskClaPart?: (targetId: string) => void;
}) {
  const isStructured = part.type === "STRUCTURED";
  const partViews = part.parts ?? [];
  const allAnswered = isStructured
    ? partViews.every((p) => (flow.partAnswers[p.id] ?? "").trim().length > 0)
    : Boolean(flow.chosen);

  return (
    <div className="space-y-4">
      {/* SME (demo figure 16): the part's problem with right-aligned mark
          placement — part 1 of a family carries the shared stimulus */}
      {part.stem ? <PartProblem md={part.stem} /> : null}
      {showHelp && <QuestionHelpPanel question={part} />}

      {isStructured ? (
        flow.mode === null || flow.attempt === null ? (
          <StructuredAnswerInputs
            question={part}
            partAnswers={flow.partAnswers}
            onPartAnswer={(partId, text) =>
              onPatch({ partAnswers: { ...flow.partAnswers, [partId]: text } })
            }
            confidence={flow.confidence}
            setConfidence={(v) => onPatch({ confidence: v })}
            disabled={flow.busy}
            onFirstTouch={onFirstTouch}
            busy={flow.busy}
            allAnswered={allAnswered}
            error={flow.error}
            onSend={onSend}
            onSmartMark={onSmartMark}
            onAskClaPart={onAskClaPart}
          />
        ) : flow.mode === "smart" ? (
          <div className="space-y-4">
            <SmartMarkPanel
              question={part}
              attemptId={flow.attempt.attemptId}
              marksPossible={flow.attempt.marksPossible}
              partAnswers={flow.partAnswers}
              autoRun
            />
            <p className="text-[11px] text-muted-foreground">
              The mark scheme stays hidden while you work with Smart Mark —
              you&apos;ve attempted the question, so you can still reveal it and
              self-mark when you&apos;re ready.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-1.5" onClick={() => onSetSchemeOpen(true)}>
                <Eye className="size-4" aria-hidden="true" />
                View answer &amp; self-mark
              </Button>
              <Button variant="ghost" onClick={onRetry}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert>
              <Send className="size-4 text-primary" aria-hidden="true" />
              <AlertTitle>Submitted — {flow.attempt.marksPossible} marks</AlertTitle>
              <AlertDescription>
                Your written answers are stored with your attempt. Mark yourself
                against the scheme — tick what you earned — or leave it for your
                teacher.
              </AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => onSetSchemeOpen(true)} className="gap-1.5">
                <Eye className="size-4" aria-hidden="true" />
                View answer &amp; self-mark
              </Button>
              <Button variant="ghost" onClick={onRetry}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Try again
              </Button>
            </div>
          </div>
        )
      ) : flow.mcqResult ? (
        <McqResult
          question={part}
          result={flow.mcqResult}
          chosen={flow.chosen}
          onAskTutorAbout={onAskTutorAbout}
          onRetry={onRetry}
        />
      ) : (
        <McqAnswerInputs
          question={part}
          chosen={flow.chosen}
          setChosen={(id) => onPatch({ chosen: id })}
          confidence={flow.confidence}
          setConfidence={(v) => onPatch({ confidence: v })}
          disabled={flow.busy}
          onFirstTouch={onFirstTouch}
          busy={flow.busy}
          allAnswered={allAnswered}
          error={flow.error}
          onSubmit={onSubmitMcq}
        />
      )}
    </div>
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

// ── MCQ answering (demo "Choose your answer" stacked letter rows) ─────────

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
    <div className="space-y-3">
      <p className="text-[13px] font-medium">Choose your answer</p>
      <div className="space-y-2" role="radiogroup" aria-label="Answer options">
        {(question.options ?? []).map((option) => {
          const isChosen = chosen === option.id;
          return (
            <div
              key={option.id}
              role="radio"
              aria-checked={isChosen}
              tabIndex={disabled ? -1 : 0}
              onClick={() => {
                if (disabled) return;
                onFirstTouch();
                setChosen(option.id);
              }}
              onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onFirstTouch();
                  setChosen(option.id);
                }
              }}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                disabled && "cursor-default",
                isChosen
                  ? "border-primary bg-primary/5"
                  : "hover:border-primary/50",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold",
                  isChosen
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-primary",
                )}
                aria-hidden
              >
                {option.label}
              </span>
              <span className="flex-1 text-[13px] leading-relaxed">
                <QuestionMarkdown>{option.text}</QuestionMarkdown>
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
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
  const [showWhy, setShowWhy] = useState(true);

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
  const hasScheme =
    !!scheme && (scheme.generalPoints.length > 0 || scheme.parts.length > 0);

  return (
    <div className="space-y-3">
      {/* demo verdict line: "Correct — well done." / "Not quite. The correct
          answer is X." (the marks + mastery note ride along, production data) */}
      <div className="flex flex-wrap items-center gap-3">
        <p
          className={cn(
            "text-[13px] font-medium",
            result.correct ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {result.correct
            ? `Correct — well done. ${result.marksAwarded}/${result.marksTotal} marks.`
            : `Not quite. The correct answer is ${result.correctOptionLabel}. ${result.marksAwarded}/${result.marksTotal} marks.`}
        </p>
        <span className="text-[11px] text-muted-foreground">
          Marked automatically — your mastery estimate for this topic has been updated.
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-8 gap-1.5 text-xs text-muted-foreground"
          onClick={onRetry}
        >
          <RotateCcw className="size-3.5" aria-hidden /> Try again
        </Button>
      </div>

      <div className="space-y-2" aria-label="Your answer and the correct answer">
        {(question.options ?? []).map((option) => {
          const isChosen = chosen === option.id;
          const isCorrect = correctOptionId === option.id;
          const showCorrect = isCorrect;
          const showWrong = isChosen && !isCorrect;
          return (
            <div
              key={option.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                showCorrect && "border-emerald-600/40 bg-emerald-600/10 dark:border-emerald-400/40 dark:bg-emerald-400/10",
                showWrong && "border-destructive/40 bg-destructive/10",
                !showCorrect && !showWrong && "opacity-70",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold",
                  showCorrect && "border-emerald-600/40 bg-emerald-600/15 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/15 dark:text-emerald-400",
                  showWrong && "border-destructive/40 bg-destructive/15 text-destructive",
                  !showCorrect && !showWrong && "text-muted-foreground",
                )}
                aria-hidden
              >
                {option.label}
              </span>
              <span className="flex-1 text-[13px] leading-relaxed">
                <QuestionMarkdown>{option.text}</QuestionMarkdown>
              </span>
              {showCorrect && (
                <CheckCircle2
                  className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
              )}
              {showWrong && (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {/* demo collapsible: "Why this is the answer" */}
      {hasScheme && (
        <div className="rounded-lg border bg-muted/20">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-3 py-2 text-[13px] font-medium"
            onClick={() => setShowWhy((v) => !v)}
            aria-expanded={showWhy}
          >
            {showWhy ? (
              <ChevronUp className="size-3.5" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
            Why this is the answer
          </button>
          {showWhy && (
            <div className="space-y-2 border-t px-3 py-2">
              {scheme!.generalPoints.map((p, i) => (
                <QuestionMarkdown key={`${p.ref ?? "pt"}-${i}`}>{p.text}</QuestionMarkdown>
              ))}
              {scheme!.parts.flatMap((part) =>
                part.points.map((p, i) => (
                  <QuestionMarkdown key={`${part.partId}-${p.ref ?? i}`}>{p.text}</QuestionMarkdown>
                )),
              )}
            </div>
          )}
        </div>
      )}

      {!result.correct && result.implicatedMisconceptionIds.length > 0 && (
        <div className="rounded-md border border-amber-700/30 bg-amber-700/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-3.5" aria-hidden /> Misconception signal detected
          </p>
          The option you chose matches a documented misconception — the learner
          model raised its probability. Watch for it in My state and the review
          queue.
        </div>
      )}

      {onAskTutorAbout && (
        <div className="border-t pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
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
            <MessagesSquare className="size-3.5" aria-hidden />
            Question help
          </Button>
        </div>
      )}
    </div>
  );
}

// ── structured answering: demo workspaces + the Send / Smart Mark fork ────

function StructuredAnswerInputs({
  question,
  partAnswers,
  onPartAnswer,
  confidence,
  setConfidence,
  disabled,
  onFirstTouch,
  busy,
  allAnswered,
  error,
  onSend,
  onSmartMark,
  onAskClaPart,
}: {
  question: StudentQuestionView;
  partAnswers: Record<string, string>;
  onPartAnswer: (partId: string, text: string) => void;
  confidence: number;
  setConfidence: (v: number) => void;
  disabled?: boolean;
  onFirstTouch: () => void;
  busy: boolean;
  allAnswered: boolean;
  error: string | null;
  onSend: () => void;
  onSmartMark: () => void;
  /** per-part CLA entry (s129): each answer box's lightbulb opens the
   *  question-anchored overlay with Approach aimed at that part */
  onAskClaPart?: (targetId: string) => void;
}) {
  const parts = question.parts ?? [];
  const multiPart = parts.length > 1;

  return (
    <div className="space-y-4">
      {parts.map((part) => (
        <div key={part.id} className="space-y-2">
          {/* SME (demo figure 16): per-part marks right-aligned, no chips/spec
              codes on the learner face; the part label chip rides the prompt */}
          <div className="flex items-center gap-2">
            <span className="inline-flex size-6 items-center justify-center rounded border bg-muted font-mono text-xs">
              {part.label}
            </span>
            {part.commandWord ? (
              <span className="text-xs font-medium capitalize text-muted-foreground">
                {part.commandWord}
              </span>
            ) : null}
            {multiPart && (
              <span className="ml-auto text-xs text-muted-foreground">
                {part.marks} mark{part.marks === 1 ? "" : "s"}
              </span>
            )}
            {onAskClaPart && (
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-6 text-muted-foreground hover:text-primary", !multiPart && "ml-auto")}
                onClick={() => onAskClaPart(part.id)}
                aria-haspopup="dialog"
                aria-label={`Ask CLA for help with part ${part.label} — scaffolded, never the answer`}
                title="Ask CLA — scaffolded help with this part, never the answer"
              >
                <Lightbulb className="size-3.5" aria-hidden />
              </Button>
            )}
          </div>
          <PartProblem md={part.prompt} />

          {/* demo "Your answer" workspace — production semantics: the text is
              stored with the attempt on submit (real answers, real evidence) */}
          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <PenLine className="size-3.5 text-primary" aria-hidden />
              <span className="text-[13px] font-medium">Your answer</span>
              <span className="text-[11px] text-muted-foreground">
                stored with your attempt when you submit
              </span>
            </div>
            <Textarea
              id={part.id}
              value={partAnswers[part.id] ?? ""}
              onFocus={onFirstTouch}
              onChange={(e) => {
                onFirstTouch();
                onPartAnswer(part.id, e.target.value);
              }}
              placeholder="Type your answer here…"
              rows={4}
              disabled={disabled}
              className="min-h-24 bg-background text-[13px]"
              aria-label={`Your answer for part ${part.label}`}
            />
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
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

// ── the mark-scheme modal (demo full-screen scheme, research §6.3 figure 9)─
// Demo presentation (topic pill, part restate with Show more, your typed
// answer alongside, AND-joined [N mark] points) carrying the PRODUCTION
// reveal-and-self-mark flow: policy-gated scheme fetch, per-part steppers,
// the single-shot self-mark recording endpoint, honest withheld/error states.

function transformMarkTags(md: string): string {
  // "**[1]**" → "**[1 mark]**" so the corpus's own tags read like SME's
  return md.replace(/\*\*\[(\d+)\]\*\*/g, (_m, n) => `**[${n} mark${Number(n) === 1 ? "" : "s"}]**`);
}

function MarkSchemeDialog({
  question,
  attempt,
  partAnswers,
  onClose,
  onDone,
}: {
  question: StudentQuestionView;
  attempt: StructuredAttemptResultView;
  partAnswers: Record<string, string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [scheme, setScheme] = useState<MarkSchemeRevealView | null>(null);
  const [schemeState, setSchemeState] = useState<"loading" | "open" | "withheld" | "error">(
    "loading",
  );
  const [expanded, setExpanded] = useState(false);
  const [selfMarks, setSelfMarks] = useState<Record<string, number>>({});
  const [selfMarkResult, setSelfMarkResult] = useState<SelfMarkView | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);

  const parts = question.parts ?? [];
  const allSelfMarked =
    parts.length > 0 && parts.every((p) => typeof selfMarks[p.id] === "number");
  const selfTotal = parts.reduce((sum, p) => sum + (selfMarks[p.id] ?? 0), 0);

  // the attempt exists: the scheme reveals (post-attempt, demo-style free
  // reveal). The dialog is conditionally mounted open, so this fetch runs
  // once per open with "loading" as the initial state.
  useEffect(() => {
    let cancelled = false;
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

  const longRestate = (question.stem ?? "").length > 220;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="exam-theme h-[92vh] max-w-4xl overflow-y-auto sm:h-[92vh]"
      >
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <Badge variant="outline" className="rounded-full px-3 py-1 text-xs font-medium">
              Mark scheme
            </Badge>
            <span className="text-sm font-normal text-muted-foreground">
              tick what you earned
            </span>
          </DialogTitle>
        </DialogHeader>

        {selfMarkResult ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-4 dark:border-emerald-400/30 dark:bg-emerald-400/5">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                Self-marked — {selfMarkResult.marksAwarded}/{selfMarkResult.marksTotal} marks
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Recorded and your mastery estimate has been updated
                {selfMarkResult.evidenceFired ? " (evidence fired)" : ""}. Your
                teacher can still review and override it — self-marks never enter
                the teacher κ calibration sample.
              </p>
            </div>
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
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button variant="outline" onClick={onDone}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Try again
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {schemeState === "loading" && <Skeleton className="h-32 w-full" />}

            {schemeState === "withheld" && (
              <div className="rounded-md border border-amber-700/30 bg-amber-700/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                The mark scheme isn&apos;t open for self-marking yet (awaiting
                teacher validation). Your answers stay in the teacher marking
                queue.
              </div>
            )}

            {schemeState === "error" && (
              <div className="rounded-md border border-amber-700/30 bg-amber-700/10 px-3 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                The mark scheme couldn&apos;t be loaded — your answers stay in the
                teacher marking queue.
              </div>
            )}

            {schemeState === "open" && scheme && (
              <>
                {/* question restate with Show more (demo) */}
                {question.stem && (
                  <section className="space-y-2 rounded-lg border bg-card p-4">
                    <div className={cn(!expanded && longRestate && "relative max-h-24 overflow-hidden")}>
                      <QuestionMarkdown>{question.stem}</QuestionMarkdown>
                      {!expanded && longRestate && (
                        <div
                          className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent"
                          aria-hidden
                        />
                      )}
                    </div>
                    {longRestate && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-primary"
                        onClick={() => setExpanded((v) => !v)}
                      >
                        {expanded ? "Show less" : "Show more"}
                      </Button>
                    )}
                  </section>
                )}

                {parts.map((part) => {
                  const schemePart = scheme.parts.find((sp) => sp.partId === part.id);
                  const typed = (partAnswers[part.id] ?? "").trim();
                  return (
                    <section key={part.id} className="space-y-2 rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[13px] font-semibold">
                          {parts.length > 1 ? part.label : "Q"}
                        </span>
                        {/* SME (figure 16): part marks right-aligned in the scheme row */}
                        <span className="ml-auto text-[13px] text-muted-foreground">
                          {part.marks} mark{part.marks === 1 ? "" : "s"}
                        </span>
                      </div>
                      <PartProblem md={part.prompt} />
                      {typed && (
                        <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
                          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-primary">
                            <PenLine className="size-3" aria-hidden /> Your typed answer
                          </p>
                          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{typed}</p>
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            Compare it with the marking points below — award yourself
                            the marks you clearly earned.
                          </p>
                        </div>
                      )}
                      {schemePart && schemePart.points.length > 0 ? (
                        <ul className="space-y-1.5 border-t pt-2">
                          {schemePart.points.map((p, i) => (
                            <li
                              key={`${p.ref ?? "pt"}-${i}`}
                              className="flex items-start gap-2 text-sm"
                            >
                              <span className="mt-0.5 shrink-0 rounded border border-slate-300 bg-slate-50 px-1 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                                {p.ref ?? "•"}
                              </span>
                              <span className="min-w-0 flex-1">
                                <QuestionMarkdown>{transformMarkTags(p.text)}</QuestionMarkdown>
                              </span>
                              <span className="mt-0.5 shrink-0 text-[11px] text-muted-foreground">
                                {p.marks} mark{p.marks === 1 ? "" : "s"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="border-t pt-2 text-xs text-muted-foreground">
                          No scheme points published for this part.
                        </p>
                      )}
                      {/* the production self-mark stepper — demo's "award
                          yourself the marks you clearly earned", made real */}
                      <div className="flex items-center justify-between gap-2 border-t pt-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Your mark for this part
                        </span>
                        <MarksStepper
                          value={selfMarks[part.id]}
                          max={part.marks}
                          onChange={(v) => setSelfMarks((prev) => ({ ...prev, [part.id]: v }))}
                        />
                      </div>
                    </section>
                  );
                })}

                {scheme.generalPoints.length > 0 && (
                  <div className="rounded-lg border border-dashed p-4">
                    <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                      General marking points
                    </p>
                    {scheme.generalPoints.map((p, i) => (
                      <QuestionMarkdown key={`${p.ref ?? "gp"}-${i}`}>{p.text}</QuestionMarkdown>
                    ))}
                  </div>
                )}

                {recordError && (
                  <Alert variant="destructive">
                    <AlertDescription>{recordError}</AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button onClick={recordSelfMarks} disabled={!allSelfMarked || recording}>
                    {recording ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                    )}
                    Record my self-marks
                    {allSelfMarked ? ` (${selfTotal}/${attempt.marksPossible})` : ""}
                  </Button>
                  <Button variant="ghost" onClick={onClose}>
                    Skip — leave it for the teacher
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Marking points are AND-joined (all required for the mark).
                  Self-marking updates your mastery estimate immediately; it is
                  recorded separately from teacher marks (never in the κ
                  calibration sample) and your teacher can still override it.
                </p>
              </>
            )}
          </div>
        )}

        <button
          type="button"
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100"
          onClick={onClose}
          aria-label="Close mark scheme"
        >
          <X className="size-4" aria-hidden />
        </button>
      </DialogContent>
    </Dialog>
  );
}
