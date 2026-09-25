/**
 * KGX adapters — projections of EXISTING backend read models into the
 * explorer's normalized graph. Every adapter is a pure function of data the
 * app already renders in its table views; no adapter invents or re-derives
 * educational truth (AGENT.md rule 3), and every null stays null ("Not
 * measured" honesty).
 */
import type {
  AttemptHistoryView,
  ClassOverviewView,
  ConceptGraphEdgeView,
  LearnerKnowledgeGraphView,
  LearnerStateView,
  NodeView,
} from "@/lib/types";
import { scopeChips } from "@/lib/applicability";
import type { KGXEdge, KGXGraph, KGXHost, KGXNode, KGXPanelSection } from "./types";

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── 1+2. Mastery Map / My State — the personalized KG + learner state ───────

/** KG types map onto KGX types (SUBJECT/UNIT/TOPIC/SUBTOPIC/MISCONCEPTION). */
function kgxTypeFor(t: string): KGXNode["type"] {
  switch (t) {
    case "SUBJECT":
      return "ROOT";
    case "UNIT":
      return "UNIT";
    case "TOPIC":
      return "TOPIC";
    case "SUBTOPIC":
      return "SUBTOPIC";
    case "MISCONCEPTION":
      return "MISCONCEPTION";
    default:
      return "SPEC";
  }
}

export function learnerGraphHost(
  graph: LearnerKnowledgeGraphView,
  state: LearnerStateView | null,
  opts?: {
    title?: string;
    defaultLensId?: string;
    onPracticeTopic?: (nodeId: string, title: string) => void;
  },
): KGXHost {
  // exact state rows joined by id (facts from /state, structure from the graph)
  const skills = new Map((state?.skillStates ?? []).map((s) => [s.nodeId, s]));
  const misconceptions = new Map((state?.misconceptionStates ?? []).map((m) => [m.misconceptionNodeId, m]));
  const reviews = new Map((state?.pendingReviews ?? []).map((r) => [r.nodeId, r]));

  const nodes: KGXNode[] = graph.nodes.map((n) => {
    const s = skills.get(n.id);
    const review = reviews.get(n.id);
    const miscon = misconceptions.get(n.id);
    return {
      id: n.id,
      type: kgxTypeFor(n.type),
      title: n.title,
      code: n.code,
      parentId: n.type === "MISCONCEPTION" ? null : null, // set below from childIds
      mastery: n.mastery ?? s?.mastery ?? null,
      effectiveMastery: n.effectiveMastery ?? s?.effectiveMastery ?? null,
      attempts: n.attempts ?? s?.attempts ?? null,
      correct: n.correctCount ?? s?.correctCount ?? null,
      reviewDue: !!(n.reviewDueAt ?? review),
      reviewReason: n.reviewReason ?? review?.reason ?? null,
      misconception:
        n.misconceptionProbability != null
          ? { probability: n.misconceptionProbability, active: !!n.misconceptionActive }
          : miscon
            ? { probability: miscon.probability, active: miscon.active }
            : null,
      subtitle: n.description,
      badge: n.band ?? null,
      learnersMeasured: null,
    };
  });

  // parent links: derive from childIds (the read model ships both directions)
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const raw of graph.nodes) {
    for (const cid of raw.childIds ?? []) {
      const child = byId.get(cid);
      if (child && !child.parentId) child.parentId = raw.id;
    }
  }

  const edges: KGXEdge[] = graph.prerequisiteEdges.map((e) => ({
    from: e.nodeId,
    to: e.prerequisiteId,
    kind: "pre" as const,
    label: "Requires prerequisite",
  }));

  const panelSections = (n: KGXNode): KGXPanelSection[] => {
    const sections: KGXPanelSection[] = [];
    if (n.attempts != null && n.attempts > 0) {
      const last = graph.nodes.find((g) => g.id === n.id)?.lastPracticedAt;
      sections.push({
        title: "Practice",
        rows: [
          { label: "Attempts", value: String(n.attempts) },
          { label: "Correct", value: `${n.correct ?? 0}/${n.attempts}` },
          { label: "Last practiced", value: fmtDate(last) },
        ],
      });
    }
    if (n.type === "MISCONCEPTION") {
      sections.push({
        title: "Misconception (BDT)",
        note:
          n.misconception?.active
            ? `Active — posterior probability ${Math.round(n.misconception.probability * 100)}%. Wrong answers tagged with this misconception push it up; correct evidence decays it.`
            : `Currently inactive (posterior ${n.misconception ? Math.round(n.misconception.probability * 100) : 0}%).`,
      });
    }
    return sections;
  };

  return {
    graph: { nodes, edges },
    lenses: [
      { id: "structure", label: "Structure", metric: "structure", hint: "curriculum shape — no measured overlay" },
      { id: "mastery", label: "Mastery", metric: "mastery", hint: "state ring = stored BKT mastery band" },
      { id: "effective", label: "After decay", metric: "effective", hint: "ring = effective mastery (Ebbinghaus decay since last practice)" },
      { id: "review", label: "Reviews due", metric: "review", hint: "pulsing ring = review scheduled (spaced repetition)" },
      { id: "misconception", label: "Misconceptions", metric: "misconception", types: ["ROOT", "UNIT", "TOPIC", "SUBTOPIC", "MISCONCEPTION", "SPEC"], hint: "red = active BDT misconception nodes" },
    ],
    defaultLensId: opts?.defaultLensId ?? "mastery",
    panelSections,
    nodeActions: opts?.onPracticeTopic
      ? (n) =>
          n.type === "TOPIC" || n.type === "SUBTOPIC" || n.type === "SPEC"
            ? [
                {
                  id: "practice",
                  label: "Practice this topic",
                  onSelect: (id) => opts.onPracticeTopic!(id, n.title),
                },
              ]
            : []
      : undefined,
    caption: "Rings show measured mastery (facts). Recommendations live on the dashboard — this surface does not invent advice.",
  };
}

// ── 3. History — attempts projected onto the topic graph ───────────────────

export function historyHost(
  history: AttemptHistoryView,
  graph: LearnerKnowledgeGraphView | null,
): KGXHost {
  // topic aggregates from the attempts themselves
  interface Agg {
    attempts: number;
    correct: number;
    marks: number;
    marksTotal: number;
    last: string;
    pending: number;
    misconceptions: Set<string>;
    items: { attemptId: string; label: string; detail: string; correct: boolean | null; marks: string; at: string }[];
  }
  const aggs = new Map<string, Agg>();
  for (const a of history.attempts) {
    const key = a.topicNodeId;
    let agg = aggs.get(key);
    if (!agg) {
      agg = {
        attempts: 0,
        correct: 0,
        marks: 0,
        marksTotal: 0,
        last: "",
        pending: 0,
        misconceptions: new Set<string>(),
        items: [],
      };
      aggs.set(key, agg);
    }
    agg.attempts += 1;
    if (a.correct === true) agg.correct += 1;
    if (a.correct === null) agg.pending += 1;
    if (a.marksAwarded != null) agg.marks += a.marksAwarded;
    agg.marksTotal += a.marksTotal;
    if (a.attemptedAt > agg.last) agg.last = a.attemptedAt;
    for (const m of a.implicatedMisconceptionIds ?? []) agg.misconceptions.add(m);
    const partsNote = a.parts?.length ? ` · ${a.parts.length} parts` : "";
    agg.items.push({
      attemptId: a.attemptId,
      label: `${a.externalRef ?? a.commandWord ?? "Attempt"}${partsNote}`,
      detail: a.stemExcerpt,
      correct: a.correct,
      marks: a.marksAwarded != null ? `${a.marksAwarded}/${a.marksTotal}` : `awaiting marks (${a.markingState})`,
      at: a.attemptedAt,
    });
  }

  const nodes: KGXNode[] = [];
  const edges: KGXEdge[] = [];

  if (graph) {
    // structural spine from the personalized graph; attempts join by topic id
    const aggByTopic = aggs;
    const spine = learnerGraphHost(graph, null, {});
    for (const n of spine.graph.nodes) {
      const agg = aggByTopic.get(n.id);
      if (n.type === "MISCONCEPTION") continue; // history lens is topic-level
      nodes.push({
        ...n,
        attempts: agg?.attempts ?? null,
        correct: agg?.correct ?? null,
        mastery: null, // history surface shows activity facts, not mastery
        effectiveMastery: null,
        misconception: null,
        reviewDue: false,
      });
    }
    for (const e of spine.graph.edges) edges.push(e);
    // drop topic nodes with no attempts from the spine? No — keep the shape
    // honest: unattempted topics show as unmeasured (no ring) next to the rest.
  } else {
    for (const [topicId, agg] of aggs) {
      const a = history.attempts.find((x) => x.topicNodeId === topicId);
      nodes.push({
        id: topicId,
        type: "TOPIC",
        title: a?.topicTitle ?? topicId,
        code: a?.topicCode ?? null,
        parentId: null,
        attempts: agg.attempts,
        correct: agg.correct,
      });
    }
  }

  // attach misconception nodes for implicated misconceptions (state edges)
  if (graph) {
    const misById = new Map(graph.nodes.filter((n) => n.type === "MISCONCEPTION").map((n) => [n.id, n]));
    const linked = new Set<string>();
    for (const [topicId, agg] of aggs) {
      for (const mId of agg.misconceptions) {
        const m = misById.get(mId);
        if (!m || linked.has(mId)) continue;
        linked.add(mId);
        nodes.push({
          id: m.id,
          type: "MISCONCEPTION",
          title: m.title,
          code: m.code,
          // collar the implicated topic (state overlay) — the graph host links
          // misconceptions by edges, but the layout needs the parent to hug it
          parentId: topicId,
          misconception: { probability: 1, active: true },
          subtitle: `Implicated by your answers on ${graph.nodes.find((g) => g.id === topicId)?.title ?? "a topic"}`,
        });
        edges.push({ from: m.id, to: topicId, kind: "state", label: "Implicated by your attempts" });
      }
    }
  }

  const panelSections = (n: KGXNode): KGXPanelSection[] => {
    const agg = aggs.get(n.id);
    if (!agg) return [];
    const rows = [
      { label: "Attempts here", value: String(agg.attempts) },
      { label: "Correct", value: `${agg.correct}/${agg.attempts}` },
      { label: "Marks awarded", value: `${agg.marks}/${agg.marksTotal}` },
      { label: "Awaiting marks", value: String(agg.pending) },
    ];
    const recent = [...agg.items]
      .sort((x, y) => (x.at < y.at ? 1 : -1))
      .slice(0, 6)
      .map(
        (it) =>
          `${it.correct === true ? "✓" : it.correct === false ? "✗" : "…"} ${it.label} — ${it.marks} · ${fmtDate(it.at)}`,
      );
    return [
      { title: "Attempt trail", rows },
      ...(recent.length ? [{ title: "Recent attempts", note: recent.join("\n") }] : []),
    ];
  };

  return {
    graph: { nodes, edges },
    lenses: [
      {
        id: "activity",
        label: "Activity",
        metric: "activity",
        hint: "badge = attempts on the topic · ring = correctness ratio",
      },
      {
        id: "marks",
        label: "Marks",
        metric: "activity",
        hint: "panel shows marks awarded vs available per topic",
      },
      {
        id: "misconception",
        label: "Misconceptions",
        metric: "misconception",
        hint: "misconception nodes implicated by your wrong answers",
      },
    ],
    defaultLensId: "activity",
    panelSections,
    caption:
      "Read-only record of where your learning happened. “…” = structured answers awaiting authoritative marks — never a guess.",
  };
}

// ── 4. Teacher Curriculum Graph — concept graph edges + spec tree ──────────

/**
 * The concept-graph read model arrives as a NESTED NodeView tree
 * (SUBJECT → SECTION → SUBSECTION → SPECIFICATION_POINT → CONCEPT/PRACTICAL
 * → MISCONCEPTION) plus a flat validated-edges list. The adapter flattens the
 * tree with parent links (hier spine) and adds the semantic edges verbatim
 * with their validation status + provenance for the edge explainer.
 */
export function conceptGraphHost(
  edgesView: ConceptGraphEdgeView[],
  tree: NodeView | null,
  opts?: { onOpenSpec?: (node: NodeView) => void },
): KGXHost {
  const nodes: KGXNode[] = [];
  const specById = new Map<string, NodeView>();

  const typeFor = (t: string): KGXNode["type"] => {
    switch (t) {
      case "SUBJECT":
        return "ROOT";
      case "SECTION":
      case "SUBSECTION":
        return "UNIT";
      case "SPECIFICATION_POINT":
        return "SPEC";
      case "CONCEPT":
        return "CONCEPT";
      case "PRACTICAL":
        return "PRACTICAL";
      case "MISCONCEPTION":
        return "MISCONCEPTION";
      default:
        return "TOPIC";
    }
  };

  const walk = (node: NodeView, parentId: string | null) => {
    specById.set(node.id, node);
    nodes.push({
      id: node.id,
      type: typeFor(node.type),
      title: node.title,
      code: node.code,
      parentId,
      validationStatus: node.validationStatus,
      badge: node.validationStatus !== "VALIDATED" ? node.validationStatus : null,
      subtitle: node.description,
    });
    for (const child of node.children ?? []) walk(child, node.id);
  };
  if (tree) walk(tree, null);

  const kgxEdges: KGXEdge[] = edgesView
    .filter((e) => specById.has(e.source.nodeId) && specById.has(e.target.nodeId))
    .map((e) => ({
      from: e.source.nodeId,
      to: e.target.nodeId,
      kind: e.relation === "REQUIRES_PREREQUISITE" ? ("pre" as const) : ("rel" as const),
      label: e.relation,
      validationStatus: e.validationStatus,
      provenance: [e.provenance, e.rationale].filter(Boolean).join(" — ") || null,
    }));

  const validatedCount = edgesView.filter((e) => e.validationStatus === "VALIDATED").length;

  return {
    graph: { nodes, edges: kgxEdges },
    lenses: [
      {
        id: "validation",
        label: "Validation",
        metric: "validation",
        hint: `green ring = VALIDATED · dashed = suggested — ${validatedCount}/${edgesView.length} semantic edges validated`,
      },
      {
        id: "structure",
        label: "Structure",
        metric: "structure",
        hint: "graph shape without the validation overlay",
      },
    ],
    defaultLensId: "validation",
    panelSections: (n) => {
      const sections: KGXPanelSection[] = [];
      // official assessment scope (T-C25): the applicability core serves on
      // the spec-point NodeView (T-C24/V39) — chip values ARE the canonical
      // object (demo kgApplicabilityChips parity); honestly absent when the
      // point is unscoped
      const app = specById.get(n.id)?.applicability;
      if (app) {
        const chips = scopeChips(app);
        if (chips.length) {
          sections.push({
            title: "Assessment scope",
            chips,
            note: app.rule ?? undefined,
          });
        }
      }
      const related = edgesView.filter((e) => e.source.nodeId === n.id || e.target.nodeId === n.id);
      if (related.length) {
        sections.push({
          title: `Relationships (${related.length})`,
          rows: related
            .slice(0, 12)
            .map((e) => ({
              label: `${e.relation} · ${e.validationStatus}`,
              value: `${e.source.code || e.source.title} → ${e.target.code || e.target.title}`,
            })),
        });
      }
      return sections;
    },
    nodeActions: opts?.onOpenSpec
      ? (n) => {
          const spec = specById.get(n.id);
          return spec ? [{ id: "open", label: "Open in the list view", onSelect: () => opts.onOpenSpec!(spec) }] : [];
        }
      : undefined,
    caption:
      "Official curriculum anchor (blue spec points, verbatim) vs graph-derived layer (green concepts, red misconceptions) — every node and edge carries its real validation status; click an edge for provenance.",
  };
}

// ── 5. Class Intelligence — class aggregates over the topic graph ──────────

export function classGraphHost(
  overview: ClassOverviewView,
  drill?: {
    topicNodeId: string;
    affectedLearners: { displayName: string; mastery: number | null; reason: string }[];
  } | null,
  opts?: { onOpenDrillDown?: (topic: ClassOverviewView["topics"][number]) => void },
): KGXHost {
  // build UNIT→TOPIC hierarchy from parentCode (the aggregate carries it)
  const unitByCode = new Map<string, { id: string; title: string }>();
  for (const t of overview.topics) {
    if (t.parentCode && !unitByCode.has(t.parentCode)) {
      unitByCode.set(t.parentCode, { id: `unit:${t.parentCode}`, title: t.parentTitle ?? t.parentCode });
    }
  }
  const rootId = `root:${overview.rootCode}`;

  const nodes: KGXNode[] = [
    {
      id: rootId,
      type: "ROOT",
      title: overview.rootCode,
      parentId: null,
      subtitle: `${overview.enrolledLearners} enrolled · ${overview.learnersWithEvidence} with evidence`,
    },
  ];
  for (const [id, u] of unitByCode) {
    nodes.push({ id: u.id, type: "UNIT", title: u.title, code: id, parentId: rootId });
  }
  for (const t of overview.topics) {
    const parentId = t.parentCode ? `unit:${t.parentCode}` : rootId;
    nodes.push({
      id: t.nodeId,
      type: "TOPIC",
      title: t.title,
      code: t.code,
      parentId,
      mastery: t.meanMastery,
      learnersMeasured: t.learnersMeasured,
      attempts: t.evidenceBackedAttempts,
      reviewDue: t.dueReviews > 0,
      reviewReason: t.dueReviews > 0 ? `${t.dueReviews} reviews due` : null,
      misconception:
        t.learnersWithActiveMisconception > 0
          ? {
              probability: Math.min(1, t.activeMisconceptionSignals / Math.max(1, t.learnersMeasured)),
              active: true,
            }
          : null,
      tutorAsks: t.tutorEngagements,
      badge: t.masteryBand,
      subtitle: `${t.servableQuestions} servable questions`,
    });
  }

  const edges: KGXEdge[] = overview.weakPrerequisites.map((w) => ({
    from: w.prerequisiteNodeId,
    to: w.prerequisiteNodeId, // replaced below — dependents need edges; see loop
    kind: "pre" as const,
    label: "Weak prerequisite for",
    provenance: `${w.learnersMeasured} learners measured · mean ${w.meanMastery != null ? Math.round(w.meanMastery * 100) + "%" : "—"}`,
  }));
  // weak-prerequisite edges: prerequisite → each dependent topic that exists
  const topicById = new Map(overview.topics.map((t) => [t.nodeId, t]));
  edges.length = 0;
  for (const w of overview.weakPrerequisites) {
    for (const dep of w.dependents) {
      if (!topicById.has(dep.nodeId) || dep.nodeId === w.prerequisiteNodeId) continue;
      edges.push({
        from: w.prerequisiteNodeId,
        to: dep.nodeId,
        kind: "pre",
        label: "Weak prerequisite for",
        provenance: `prereq mean ${w.meanMastery != null ? Math.round(w.meanMastery * 100) + "%" : "—"} · dependent mean ${dep.meanMastery != null ? Math.round(dep.meanMastery * 100) + "%" : "—"}`,
      });
    }
  }

  return {
    graph: { nodes, edges },
    lenses: [
      {
        id: "class",
        label: "Class mastery",
        metric: "class",
        hint: "ring = class mean mastery band (graded evidence only)",
      },
      {
        id: "misconception",
        label: "Misconceptions",
        metric: "misconception",
        hint: "red = topics with learners carrying active misconceptions",
      },
      {
        id: "review",
        label: "Reviews due",
        metric: "review",
        hint: "pulsing = topics with due spaced-repetition reviews",
      },
      {
        id: "engagement",
        label: "Engagement",
        metric: "structure",
        hint: "tutor asks shown in the panel — engagement, never weakness",
      },
    ],
    defaultLensId: "class",
    panelSections: (n) => {
      const t = topicById.get(n.id);
      if (!t) return [];
      const sections: KGXPanelSection[] = [
        {
          title: "Class aggregate",
          rows: [
            { label: "Learners measured", value: `${t.learnersMeasured}/${overview.learnersWithEvidence || overview.enrolledLearners}` },
            { label: "Mean mastery", value: t.meanMastery != null ? `${Math.round(t.meanMastery * 100)}%` : "—" },
            { label: "Band", value: t.masteryBand },
            { label: "Evidence-backed attempts", value: String(t.evidenceBackedAttempts) },
            { label: "Active misconceptions", value: `${t.learnersWithActiveMisconception} learners · ${t.activeMisconceptionSignals} signals` },
            { label: "Tutor asks", value: String(t.tutorEngagements) },
            { label: "Due reviews", value: String(t.dueReviews) },
          ],
        },
      ];
      if (drill && drill.topicNodeId === n.id && drill.affectedLearners.length) {
        sections.push({
          title: "Affected learners (drill-down)",
          note: drill.affectedLearners
            .slice(0, 10)
            .map(
              (l) =>
                `${l.displayName}: ${l.mastery != null ? Math.round(l.mastery * 100) + "%" : "unmeasured"} · ${l.reason.replaceAll("_", " ").toLowerCase()}`,
            )
            .join("\n"),
        });
      }
      return sections;
    },
    nodeActions: opts?.onOpenDrillDown
      ? (n) => {
          const t = topicById.get(n.id);
          return t ? [{ id: "drill", label: "Open drill-down", onSelect: () => opts.onOpenDrillDown!(t) }] : [];
        }
      : undefined,
    caption:
      "Class-level facts only: mastery from graded BKT evidence, misconceptions from BDT estimates, tutor asks are engagement — never weakness (productization sprint §4).",
  };
}
