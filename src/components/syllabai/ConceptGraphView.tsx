"use client";

/**
 * V15 teacher concept-graph surface (session 56): the seeded 4CH1 curriculum
 * + settled T-C11 graph, teacher-facing.
 *
 * Everything here is a projection of backend read models — no business rules.
 * The backend enforces /api/v1/teacher/** (TEACHER/ADMIN); this component is
 * only reached from the Teacher tab.
 *
 * Honesty rules (the operator's directive):
 * - the OFFICIAL CURRICULUM ANCHOR (spec-point tree, verbatim wording) is
 *   visually and semantically distinct from the GRAPH-DERIVED layer
 *   (T-C11 concepts, misconceptions, validated relationships);
 * - every node/edge shows its real validation status (VALIDATED /
 *   SUGGESTED) and provenance line — the graph's origin is never hidden,
 *   the internal machinery is not over-exposed;
 * - a spec point with no settled concept graph shows an explicit empty
 *   state ("no settled graph yet"), never fabricated content;
 * - activation is deterministic + idempotent — the button re-verifies the
 *   pinned snapshot and reports reused rows, never duplicates.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  BookOpen,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Network,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { KGExplorer } from "@/components/syllabai/kg-explorer/KGExplorer";
import { conceptGraphHost } from "@/components/syllabai/kg-explorer/adapters";
import type {
  ConceptGraphEdgeView,
  ConceptGraphSeedSummary,
  NodeView,
  SubjectView,
} from "@/lib/types";

type LoadState = "loading" | "ready" | "error";

export function ConceptGraphView() {
  // subject + activation
  const [subjects, setSubjects] = useState<SubjectView[] | null>(null);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [rootId, setRootId] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [seedSummary, setSeedSummary] = useState<ConceptGraphSeedSummary | null>(null);

  // read models
  const [tree, setTree] = useState<NodeView | null>(null);
  const [treeState, setTreeState] = useState<LoadState>("loading");
  const [edges, setEdges] = useState<ConceptGraphEdgeView[] | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);

  // navigation
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["4CH1-S1", "4CH1-S3"]));
  const [selectedSp, setSelectedSp] = useState<NodeView | null>(null);
  // v75 explorer mode over the same read models (session-129)
  const [mode, setMode] = useState<"list" | "graph">("list");

  // ── data loading ───────────────────────────────────────────────

  const loadSubjects = useCallback(async () => {
    try {
      const list = await api.subjects();
      setSubjects(list);
      setSubjectError(null);
      const preferred = list.find((s) => s.code === "4CH1" && s.knowledgeNodeId);
      setRootId((current) => current ?? preferred?.knowledgeNodeId ?? null);
    } catch (e) {
      setSubjectError(e instanceof ApiError ? e.message : "Could not load subjects.");
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (!rootId) return;
    let cancelled = false;
    setTreeState("loading");
    setGraphError(null);
    setSelectedSp(null);
    Promise.all([api.knowledgeTree(rootId, true), api.conceptGraphEdges(rootId)])
      .then(([treeView, edgeView]) => {
        // fast subject switches: the slower request must not render one
        // subject's tree/edges under another subject's selection
        if (cancelled) return;
        setTree(treeView);
        setEdges(edgeView.edges);
        setTreeState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setGraphError(e instanceof ApiError ? e.message : "Could not load the concept graph.");
        setTreeState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  const activate = useCallback(async () => {
    setActivating(true);
    try {
      const summary = await api.conceptGraphActivate();
      setSeedSummary(summary);
      await loadSubjects();
      setRootId(summary.rootNodeId);
    } catch (e) {
      setSubjectError(
        e instanceof ApiError ? e.message : "Activation failed — the seed is fail-closed.",
      );
    } finally {
      setActivating(false);
    }
  }, [loadSubjects]);

  // ── derived read models ────────────────────────────────────────

  const sections = useMemo(() => tree?.children ?? [], [tree]);

  /** edges touching a node id (both directions), deterministically ordered. */
  const edgesByNode = useMemo(() => {
    const map = new Map<string, ConceptGraphEdgeView[]>();
    if (!edges) return map;
    for (const e of edges) {
      for (const id of [e.source.nodeId, e.target.nodeId]) {
        map.set(id, [...(map.get(id) ?? []), e]);
      }
    }
    return map;
  }, [edges]);

  /** the selected SP's graph-derived children: concepts, practicals, misconceptions. */
  const spDetail = useMemo(() => {
    if (!selectedSp) return null;
    const concepts = selectedSp.children.filter((c) => c.type === "CONCEPT");
    const practicals = selectedSp.children.filter(
      (c) => c.type === "SUBTOPIC" && c.code.includes("-PR-"),
    );
    const misconceptions = concepts.flatMap((c) =>
      c.children.filter((m) => m.type === "MISCONCEPTION").map((m) => ({ concept: c, mis: m })),
    );
    const subtreeIds = [
      selectedSp.id,
      ...selectedSp.children.flatMap((c) => [c.id, ...c.children.map((m) => m.id)]),
    ];
    const spEdges = (edges ?? []).filter(
      (e) =>
        (subtreeIds.includes(e.source.nodeId) || subtreeIds.includes(e.target.nodeId)) &&
        // structural identity edges (misconception attach) show under the nodes already
        !(
          ["MISCONCEPTION_OF", "REMEDIATED_BY", "WRONG_ANSWER_PATTERN"].includes(e.relation) &&
          e.source.nodeType === "MISCONCEPTION" &&
          subtreeIds.includes(e.target.nodeId)
        ),
    );
    return { concepts, practicals, misconceptions, edges: spEdges };
  }, [selectedSp, edges]);

  // ── render helpers ─────────────────────────────────────────────

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const renderSubsections = (section: NodeView) =>
    section.children.map((subsection) => {
      const open = expanded.has(subsection.code);
      return (
        <div key={subsection.id}>
          <button
            type="button"
            onClick={() => toggle(subsection.code)}
            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-muted"
            aria-expanded={open}
          >
            {open ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="truncate font-medium">{subsection.title}</span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {subsection.code}
            </span>
          </button>
          {open && <div className="ml-3 border-l pl-2">{renderSpecPoints(subsection)}</div>}
        </div>
      );
    });

  const renderSpecPoints = (subsection: NodeView) =>
    subsection.children.map((sp) => {
      const conceptCount = sp.children.filter((c) => c.type === "CONCEPT").length;
      const selected = selectedSp?.id === sp.id;
      return (
        <button
          key={sp.id}
          type="button"
          onClick={() => setSelectedSp(sp)}
          className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${
            selected ? "bg-muted ring-1 ring-primary/40" : ""
          }`}
          aria-current={selected ? "true" : undefined}
        >
          <span className="shrink-0 font-mono text-[10px] text-primary">{sp.code.replace("4CH1-", "")}</span>
          <span className="truncate">{sp.title}</span>
          {conceptCount > 0 ? (
            <Badge variant="secondary" className="ml-auto h-4 shrink-0 px-1.5 text-[9px]">
              {conceptCount} concept{conceptCount > 1 ? "s" : ""}
            </Badge>
          ) : null}
        </button>
      );
    });

  const statusBadge = (status: string) =>
    status === "VALIDATED" ? (
      <Badge className="h-5 gap-1 bg-emerald-600 text-[10px]">
        <ShieldCheck className="size-3" aria-hidden="true" /> validated
      </Badge>
    ) : (
      <Badge className="h-5 gap-1 bg-amber-500 text-[10px]">
        <Sparkles className="size-3" aria-hidden="true" /> suggested
      </Badge>
    );

  // ── render ─────────────────────────────────────────────────────

  if (subjectError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">{subjectError}</CardContent>
      </Card>
    );
  }

  if (!subjects) {
    return <Skeleton className="h-96 w-full" />;
  }

  const subjectsWithRoot = subjects.filter((s) => s.knowledgeNodeId);

  return (
    <div className="space-y-4">
      {/* ── header: activation + subject scope ──────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4 text-primary" aria-hidden="true" />
            Curriculum concept graph
          </CardTitle>
          <CardDescription>
            The official 4CH1 specification tree (blue) with the settled T-C11 concept layer
            (violet) — validated prerequisites, misconception remediation and related-concept
            relationships between the concepts under each spec point.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {subjectsWithRoot.length > 0 ? (
            <Select
              value={rootId ?? ""}
              onValueChange={(value) => {
                setRootId(value);
                setSelectedSp(null);
              }}
            >
              <SelectTrigger className="w-64" aria-label="Subject">
                <SelectValue placeholder="Choose a subject" />
              </SelectTrigger>
              <SelectContent>
                {subjectsWithRoot.map((s) => (
                  <SelectItem key={s.id} value={s.knowledgeNodeId!}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-sm text-muted-foreground">
              No seeded subject yet — activate the 4CH1 curriculum concept graph first.
            </span>
          )}
          <Button size="sm" variant="outline" onClick={activate} disabled={activating}>
            <BookOpen className="size-4" aria-hidden="true" />
            {activating
              ? "Seeding…"
              : seedSummary?.alreadyActive
                ? "Re-verify 4CH1 seed"
                : "Activate 4CH1 concept graph"}
          </Button>
          {seedSummary && (
            <span className="text-xs text-muted-foreground" data-testid="concept-graph-summary">
              {seedSummary.alreadyActive
                ? `already active — ${seedSummary.nodesReused} nodes / ${seedSummary.edgesReused} edges reused (0 created)`
                : `${seedSummary.nodesCreated} nodes / ${seedSummary.edgesCreated} edges seeded — ${seedSummary.validatedSemanticEdges} validated relationships`}
            </span>
          )}
          <span className="ml-auto">
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as "list" | "graph")}
              aria-label="Concept graph view"
              disabled={!tree || !edges}
            >
              <ToggleGroupItem value="list" className="gap-1.5 text-xs">
                <BookOpen className="size-3.5" aria-hidden="true" />
                List
              </ToggleGroupItem>
              <ToggleGroupItem value="graph" className="gap-1.5 text-xs">
                <Network className="size-3.5" aria-hidden="true" />
                Explorer
              </ToggleGroupItem>
            </ToggleGroup>
          </span>
        </CardContent>
      </Card>

      {/* ── explorer: the v75-style whole-graph view ───────────── */}
      {rootId && mode === "graph" && tree && edges && (
        <KGExplorer
          key={rootId}
          height={620}
          title="Curriculum concept graph — explorer"
          subtitle="spec anchor vs graph-derived layer · click an edge for its provenance"
          host={conceptGraphHost(edges, tree, {
            onOpenSpec: (node) => {
              setSelectedSp(node);
              setMode("list");
            },
          })}
        />
      )}

      {/* ── browser: curriculum tree | spec-point detail ────────── */}
      {rootId && mode === "list" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,2fr)_3fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <BookOpen className="size-4 text-sky-600" aria-hidden="true" />
                Official specification points
              </CardTitle>
              <CardDescription className="text-xs">
                Pearson Edexcel International GCSE (9-1) Chemistry — sections, subsections and
                verbatim spec points (the curriculum anchor).
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[28rem] overflow-y-auto">
              {treeState === "loading" ? (
                <Skeleton className="h-64 w-full" />
              ) : treeState === "error" || !tree ? (
                <p className="text-sm text-destructive">{graphError}</p>
              ) : (
                <div className="space-y-1">{sections.map(renderSubsections)}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Network className="size-4 text-violet-600" aria-hidden="true" />
                Spec-point concept detail
              </CardTitle>
              <CardDescription className="text-xs">
                Select a spec point on the left — its graph-derived academic structure appears
                here, with validation status and provenance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedSp ? (
                <p className="text-sm text-muted-foreground">
                  No spec point selected. Concepts appear only where the T-C11 graph has settled
                  content (currently Section 1 and Section 3).
                </p>
              ) : (
                <div className="space-y-4" data-testid="concept-graph-detail">
                  {/* the official anchor */}
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/40">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className="bg-sky-600 text-[10px]">official spec point</Badge>
                      {statusBadge(selectedSp.validationStatus)}
                      <span className="font-mono text-xs text-primary">
                        {selectedSp.code.replace("4CH1-", "")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">{selectedSp.description ?? selectedSp.title}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {selectedSp.provenance}
                    </p>
                  </div>

                  {/* the graph-derived concepts */}
                  <div>
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600">
                      <BookOpenCheck className="size-3.5" aria-hidden="true" />
                      Graph-derived concepts (T-C11 settled store)
                    </h4>
                    {spDetail!.concepts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No settled concept graph for this spec point yet — nothing is fabricated;
                        the concept layer covers currently settled slices only.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {spDetail!.concepts.map((c) => (
                          <li key={c.id} className="rounded-md border p-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{c.title}</span>
                              {statusBadge(c.validationStatus)}
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {c.code}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              graph-derived concept · anchored here (suggested placement) ·{" "}
                              {c.provenance}
                            </p>
                            {c.children
                              .filter((m) => m.type === "MISCONCEPTION")
                              .map((m) => (
                                <div
                                  key={m.id}
                                  className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 dark:border-rose-900 dark:bg-rose-950/40"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge className="bg-rose-600 text-[10px]">misconception</Badge>
                                    {statusBadge(m.validationStatus)}
                                    <span className="text-xs font-medium">{m.title}</span>
                                  </div>
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    {m.code} · {m.description}
                                  </p>
                                </div>
                              ))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* required practicals anchored on this SP */}
                  {spDetail!.practicals.length > 0 && (
                    <div>
                      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-sky-600">
                        <FlaskConical className="size-3.5" aria-hidden="true" />
                        Required practicals (official spec)
                      </h4>
                      <ul className="space-y-1.5">
                        {spDetail!.practicals.map((p) => (
                          <li key={p.id} className="rounded-md border border-sky-200 p-2 dark:border-sky-900">
                            <div className="flex flex-wrap items-center gap-2">
                              {statusBadge(p.validationStatus)}
                              <span className="text-sm">{p.title}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* validated relationships touching this SP's concepts */}
                  <div>
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-violet-600">
                      <Network className="size-3.5" aria-hidden="true" />
                      Validated relationships
                    </h4>
                    {spDetail!.edges.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No validated relationships touch this spec point&apos;s concepts yet.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {spDetail!.edges.map((e, i) => (
                          <li key={`${e.source.code}-${e.relation}-${e.target.code}-${i}`}>
                            <EdgeRow edge={e} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function EdgeRow({ edge }: { edge: ConceptGraphEdgeView }) {
  const [showRationale, setShowRationale] = useState(false);
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50/60 p-2.5 dark:border-violet-900 dark:bg-violet-950/30">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-medium">{edge.source.title}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{edge.source.code}</span>
        <span className="mx-1 font-mono text-[10px] font-semibold text-violet-700 dark:text-violet-300">
          —{humanRelation(edge.relation)}→
        </span>
        <span className="font-medium">{edge.target.title}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{edge.target.code}</span>
        {statusBadgeInline(edge.validationStatus)}
      </div>
      <button
        type="button"
        onClick={() => setShowRationale((v) => !v)}
        className="mt-1 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
        aria-expanded={showRationale}
      >
        {showRationale ? "hide provenance" : "provenance"}
      </button>
      {showRationale && (
        <div className="mt-1 space-y-1 text-[10px] text-muted-foreground">
          <p>{edge.provenance}</p>
          {edge.rationale && <p>{edge.rationale}</p>}
        </div>
      )}
    </div>
  );
}

function statusBadgeInline(status: string) {
  return status === "VALIDATED" ? (
    <Badge className="ml-auto h-4 shrink-0 bg-emerald-600 px-1.5 text-[9px]">validated</Badge>
  ) : (
    <Badge className="ml-auto h-4 shrink-0 bg-amber-500 px-1.5 text-[9px]">suggested</Badge>
  );
}

function humanRelation(relation: string): string {
  switch (relation) {
    case "REQUIRES_PREREQUISITE":
      return "requires";
    case "REMEDIATED_BY":
      return "remediated by";
    case "WRONG_ANSWER_PATTERN":
      return "shows up in";
    case "COMMONLY_CONFUSED_WITH":
      return "confused with";
    case "MISCONCEPTION_OF":
      return "misconception of";
    case "EXPLAINED_BY":
      return "explained by";
    case "RELATED_TO":
      return "related to";
    default:
      return relation.toLowerCase().replace(/_/g, " ");
  }
}
