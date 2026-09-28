"use client";

/**
 * Learner drawer state — KG phase 2 (My State + History).
 *
 * Layers the demo's honest answer to the web workbench's "My State" and
 * "History" surfaces on top of the phase-1 derivation: one derivation pass
 * (lib/learner-state.ts) feeds both the renderer overlay and this module's
 * drawer model, so the graph and the drawer can never disagree.
 *
 * What the drawer shows, and what it refuses to:
 *
 *   - My State: stored → effective mastery per touched spec point
 *     (effective = stored × Ebbinghaus retention, lib/forgetting.ts), the
 *     decay-derived review queue, exposure-only points and the awaiting-marks
 *     count. Bands mirror the renderer's paint (low <55 · developing 55–69 ·
 *     good 70–79 · strong ≥80) — computed on the EFFECTIVE number, like the
 *     web workbench's decayed bands.
 *   - Misconception watch (KG phase 3): the seeded sim learner's active /
 *     watching misconception states over the course's misconception corpus
 *     (SME/mark-scheme provenance). SIMULATED states, labelled as such — the
 *     demo has no distractor→misconception telemetry, so nothing here claims
 *     measured evidence; the corpus content itself is real, the STATE is the
 *     deterministic demo overlay.
 *   - History: the recorded evidence stream, newest first — facts only (what
 *     was answered, how it was marked, where it came from), never advice and
 *     no re-derived mastery. Typed drafts on questions without a self-score
 *     show the honest "awaiting marks" state; once a part is self-scored the
 *     draft is represented by its marked event, not by a stale awaiting row.
 *     Simulated misconception states are NOT history events — history is
 *     what the learner did, not what a model guesses.
 *
 * Everything derives from the browser-local progress store (SIMULATED,
 * browser-local, never written to course data) — the derivation is live, so
 * the drawer reflects the current store rather than a frozen log snapshot.
 */
import { useEffect, useMemo, useState } from "react";
import { useCourseProgress, type CourseProgress } from "./progress";
import { reviewDueAt, effectiveMastery, bandFor, type MasteryBand } from "./forgetting";
import {
  buildOverlay,
  emptyStats,
  fetchBridge,
  normalizeCode,
  type LearnerBridge,
  type LearnerOverlayEntry,
  type LearnerOverlayStats,
  type LearnerModel,
} from "./learner-state";

// ── overlay (phase-1 shape, unchanged contract) ─────────────────────────

export interface LearnerOverlayState {
  entries: Record<string, LearnerOverlayEntry>;
  stats: LearnerOverlayStats;
  /** bridge fetch failed — the host chip explains, the graph stays honest */
  bridgeError: boolean;
}

// ── drawer model ────────────────────────────────────────────────────────

export interface PointState {
  pointId: string;
  statement: string | null;
  /** demonstrated mastery from marked attempts — null = exposure only */
  stored: number | null;
  /** stored × Ebbinghaus retention — the honest "where am I now" number */
  effective: number | null;
  band: MasteryBand | null;
  attempts: number;
  exposure: number;
  lastAt: number;
  reviewDue: boolean;
  dueAt: number;
  /** revision notes mapped to this point (deep-linkable) */
  noteIds: string[];
  /** active simulated misconception label — display only, never mastery */
  misconception: string | null;
}

export interface ReviewItem {
  pointId: string;
  statement: string | null;
  stored: number;
  effective: number;
  dueAt: number;
  noteIds: string[];
}

export type LearnerEventKind = "marked" | "awaiting" | "exposure";

/** One sim-learner misconception state for the My State watch card
 *  (KG phase 3). Content = corpus; state = SIMULATED. */
export interface MisconceptionWatchItem {
  id: string;
  title: string;
  label: string;
  summary: string | null;
  /** normalized spec-point ids present in the exported spine */
  points: string[];
  probability: number;
  active: boolean;
  evidenceCount: number;
}

export interface MisconceptionWatch {
  items: MisconceptionWatchItem[];
  /** the seeded sim learner's own disclaimer, verbatim */
  disclaimer: string | null;
}

export interface LearnerEvent {
  id: string;
  at: number;
  kind: LearnerEventKind;
  label: string;
  /** "4/6" style value — null when nothing is measured yet */
  value: string | null;
  detail: string;
  /** normalized spec-point codes the event maps onto (may be empty) */
  points: string[];
  /** deep link when the event itself is revisitable (read notes) */
  href: string | null;
}

export interface LearnerDrawerState {
  /** summary counts (same numbers the host chip and graph legend show) */
  stats: LearnerOverlayStats;
  /** every touched point, review-due first, then weakest effective first */
  pointStates: PointState[];
  /** decay-derived review queue — due now, stalest first */
  reviewQueue: ReviewItem[];
  /** not due yet, but crossing their threshold within the window — the
   *  decay model made legible (capped) */
  upcoming: ReviewItem[];
  /** misconception watch (KG phase 3) — null when the course has no corpus */
  misconceptionWatch: MisconceptionWatch | null;
  /** recorded evidence stream, newest first (capped) */
  events: LearnerEvent[];
  /** number of recorded signals before the display cap */
  eventCount: number;
}

/** History display cap — the store stays small in practice; the footer
 *  reports the uncounted tail honestly. */
const EVENTS_CAP = 300;

/** Upcoming-review horizon — points crossing their threshold within this
 *  window appear as a muted "coming up" list under the queue. */
const UPCOMING_WINDOW_MS = 90 * 86_400_000;
const UPCOMING_CAP = 5;

/** Fetch the exported KG JSON's spec-point statements (module-cached). */
const titlesCache = new Map<string, Promise<Record<string, string>>>();

function fetchTitles(course: string): Promise<Record<string, string>> {
  const hit = titlesCache.get(course);
  if (hit) return hit;
  const promise = fetch(`/kg/data/${encodeURIComponent(course)}.json`)
    .then((res) => (res.ok ? (res.json() as Promise<SpecPointNode[] | KgJson>) : null))
    .then((json) => {
      if (!json) return {};
      const nodes = Array.isArray(json) ? json : (json.nodes ?? []);
      const titles: Record<string, string> = {};
      for (const n of nodes) {
        if (n.type === "SpecificationPoint" && n.pointId) {
          titles[n.pointId] = (n.statement ?? n.label ?? "").trim();
        }
      }
      return titles;
    })
    .catch(() => ({}));
  titlesCache.set(course, promise);
  return promise;
}

interface SpecPointNode {
  type?: string;
  pointId?: string;
  label?: string;
  statement?: string;
}

interface KgJson {
  nodes?: SpecPointNode[];
}

// ── derivation ──────────────────────────────────────────────────────────

function buildDrawerState(
  progress: CourseProgress,
  bridge: LearnerBridge,
  model: LearnerModel,
  titles: Record<string, string>,
  now: number,
): LearnerDrawerState {
  const codeSet = new Set(bridge.pointIds);
  const normalize = (raw: string) => normalizeCode(raw, bridge.codePrefix);

  /** raw bundle codes → the point ids the exported spine actually carries */
  const toPointIds = (rawCodes: string[] | undefined): string[] => {
    if (!rawCodes) return [];
    return [...new Set(rawCodes.map(normalize).filter((c) => codeSet.has(c)))];
  };

  // reverse map: point → revision notes covering it (for deep links)
  const notesByPoint = new Map<string, string[]>();
  for (const [noteId, rawCodes] of Object.entries(bridge.noteCodes)) {
    for (const pid of toPointIds(rawCodes)) {
      const list = notesByPoint.get(pid) ?? [];
      list.push(noteId);
      notesByPoint.set(pid, list);
    }
  }

  // ── point states (from the phase-1 accumulators — no second truth) ──
  // decay anchors on the last MARKED attempt (d.lastAttemptAt): reading a
  // note is exposure, not practice — it must not refresh the memory clock
  const pointStates: PointState[] = model.details.map((d) => {
    const stored = d.mastery;
    const effective =
      stored == null ? null : effectiveMastery(stored, d.lastAttemptAt, now);
    return {
      pointId: d.pointId,
      statement: titles[d.pointId] ?? null,
      stored,
      effective,
      band: effective == null ? null : bandFor(effective),
      attempts: d.attempts,
      exposure: d.exposure,
      lastAt: d.lastAt,
      reviewDue: d.reviewDue,
      dueAt: stored == null ? d.lastAt : reviewDueAt(stored, d.lastAttemptAt),
      noteIds: notesByPoint.get(d.pointId) ?? [],
      misconception: d.misconception,
    };
  });
  // review-due first (stalest due date first), then measured rows weakest
  // effective first, exposure-only rows last — the order a learner would
  // work the list in
  pointStates.sort((a, b) => {
    if (a.reviewDue !== b.reviewDue) return a.reviewDue ? -1 : 1;
    const am = a.effective != null;
    const bm = b.effective != null;
    if (am !== bm) return am ? -1 : 1;
    if (am && bm) {
      const d = (a.effective as number) - (b.effective as number);
      if (d !== 0) return d;
    }
    return b.lastAt - a.lastAt;
  });

  const reviewQueue: ReviewItem[] = pointStates
    .filter((p) => p.reviewDue && p.stored != null)
    .map((p) => ({
      pointId: p.pointId,
      statement: p.statement,
      stored: p.stored as number,
      effective: p.effective as number,
      dueAt: p.dueAt,
      noteIds: p.noteIds,
    }))
    .sort((a, b) => a.dueAt - b.dueAt);

  const upcoming = pointStates
    .filter(
      (p) =>
        !p.reviewDue &&
        p.stored != null &&
        p.dueAt > now &&
        p.dueAt - now <= UPCOMING_WINDOW_MS,
    )
    .map((p) => ({
      pointId: p.pointId,
      statement: p.statement,
      stored: p.stored as number,
      effective: p.effective as number,
      dueAt: p.dueAt,
      noteIds: p.noteIds,
    }))
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, UPCOMING_CAP);

  // ── evidence stream (facts only — see header) ───────────────────────
  const events: LearnerEvent[] = [];

  for (const [questionId, ev] of Object.entries(progress.selfScores)) {
    if (ev.max <= 0) continue;
    events.push({
      id: `score:${questionId}`,
      at: ev.at,
      kind: "marked",
      label: "Self-marked written answer",
      value: `${ev.score}/${ev.max}`,
      detail: ev.topicSlug ? `marked against the mark scheme · ${ev.topicSlug}` : "marked against the mark scheme",
      points: toPointIds(bridge.questionCodes[questionId]),
      href: null,
    });
  }

  for (const [questionId, ev] of Object.entries(progress.mcqAnswers)) {
    events.push({
      id: `mcq:${questionId}`,
      at: ev.at,
      kind: "marked",
      label: "MCQ answered",
      value: ev.correct ? "1/1" : "0/1",
      detail: `chose ${ev.chosen ?? "—"} · ${ev.correct ? "correct" : "not correct"}`,
      points: toPointIds(bridge.questionCodes[questionId]),
      href: null,
    });
  }

  // typed drafts: only visible as "awaiting marks" while their question has
  // no self-score — after scoring, the marked event carries the record
  for (const [partId, ev] of Object.entries(progress.typedAnswers)) {
    const parentId = bridge.partParent[partId];
    if (parentId && progress.selfScores[parentId]) continue;
    events.push({
      id: `typed:${partId}`,
      at: ev.at,
      kind: "awaiting",
      label: "Written answer",
      value: null,
      detail: "saved — awaiting marks",
      points: toPointIds(bridge.questionCodes[partId] ?? bridge.questionCodes[parentId ?? ""]),
      href: null,
    });
  }

  for (const [noteId, ev] of Object.entries(progress.notesRead)) {
    events.push({
      id: `note:${noteId}`,
      at: ev.at,
      kind: "exposure",
      label: "Note read",
      value: null,
      detail: ev.helpful === "up" ? "rated helpful" : ev.helpful === "down" ? "rated not helpful" : "exposure only — never mastery",
      points: toPointIds(bridge.noteCodes[noteId]),
      href: `/revision-notes/${encodeURIComponent(noteId)}`,
    });
  }

  for (const [cardId, ev] of Object.entries(progress.flashcards)) {
    events.push({
      id: `card:${cardId}`,
      at: ev.at,
      kind: "exposure",
      label: "Flashcard rated",
      value: null,
      detail: ev.rating === "know" ? 'rated "know"' : 'rated "still-learning"',
      points: toPointIds(bridge.flashcardCodes[cardId]),
      href: null,
    });
  }

  // saved questions are bookmarks, not learning evidence — excluded on
  // purpose so the history stays a record of what actually happened

  events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));

  // ── misconception watch (KG phase 3) — active first, then probability ──
  const watchItems: MisconceptionWatchItem[] = (bridge.misconceptions ?? [])
    .map((m) => ({
      id: m.id,
      title: m.title,
      label: m.label,
      summary: m.summary,
      points: toPointIds(m.points),
      probability: m.probability,
      active: m.active,
      evidenceCount: m.evidenceCount,
    }))
    .filter((m) => m.points.length > 0)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        b.probability - a.probability ||
        a.id.localeCompare(b.id),
    );

  return {
    stats: model.stats,
    pointStates,
    reviewQueue,
    upcoming,
    misconceptionWatch: watchItems.length
      ? { items: watchItems, disclaimer: bridge.misconceptionDisclaimer }
      : null,
    events: events.slice(0, EVENTS_CAP),
    eventCount: events.length,
  };
}

// ── react binding ───────────────────────────────────────────────────────

export interface LearnerStateBundle {
  /** phase-1 overlay for the renderer postMessage — null while loading */
  overlay: LearnerOverlayState | null;
  /** phase-2 drawer model — null while the bridge loads or failed */
  drawer: LearnerDrawerState | null;
}

/**
 * Live learner state for one course: derives the renderer overlay AND the
 * drawer model from the same pass, so the graph paint and the drawer can
 * never disagree. Re-derives live on every progress-store change.
 */
export function useLearnerState(course: string): LearnerStateBundle {
  const progress = useCourseProgress(course);
  const [bridge, setBridge] = useState<LearnerBridge | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  // reset derived-fetch state on course switch during render (react.dev —
  // "adjusting state when a prop changes"), then fetch below
  const [prevCourse, setPrevCourse] = useState(course);
  if (prevCourse !== course) {
    setPrevCourse(course);
    setBridge(null);
    setTitles({});
    setFailed(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetchBridge(course).then((b) => {
      if (cancelled) return;
      if (b) setBridge(b);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [course]);

  useEffect(() => {
    let cancelled = false;
    fetchTitles(course).then((t) => {
      if (cancelled) return;
      setTitles(t);
    });
    return () => {
      cancelled = true;
    };
  }, [course]);

  return useMemo(() => {
    // decay math uses the derivation moment; the drawer recomputes on every
    // progress change and course switch, which is the honest cadence for a
    // browser-local demo (no nightly job exists to recompute server-side)
    const now = Date.now();
    if (failed) {
      return {
        overlay: { entries: {}, stats: emptyStats, bridgeError: true },
        drawer: null,
      };
    }
    if (!bridge) return { overlay: null, drawer: null };
    const model = buildOverlay(progress, bridge, now);
    return {
      overlay: { entries: model.entries, stats: model.stats, bridgeError: false },
      drawer: buildDrawerState(progress, bridge, model, titles, now),
    };
  }, [progress, bridge, titles, failed]);
}

// ── shared formatters ───────────────────────────────────────────────────

/** Coarse relative time for evidence timestamps ("just now" … "3mo ago"). */
export function formatRelative(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 36) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 45) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

/** Human label for a review due-date ("3d overdue" · "due today" · "due in 12d"). */
export function formatDue(dueAt: number, now: number): string {
  const d = (dueAt - now) / 86_400_000;
  if (d <= -1) return `${Math.floor(-d)}d overdue`;
  if (d <= 0) return "due today";
  return `due in ${Math.max(1, Math.ceil(d))}d`;
}
