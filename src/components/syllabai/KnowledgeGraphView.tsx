"use client";

/**
 * F-036: simplified 2D-first knowledge-graph visualiser (T-028).
 *
 * Renders the personalized graph (F-034 payload) as a layered left-to-right
 * SVG: columns are KG depth (subject → units → topics → subtopics), nodes are
 * coloured by the learner's proficiency band, solid muted edges are PART_OF
 * hierarchy and dashed primary edges are REQUIRES_PREREQUISITE relations.
 * MISCONCEPTION nodes are not drawn (they would clutter the structure graph);
 * they stay available to the detail panel through the node data.
 *
 * Accessibility: every node is a focusable button with a descriptive
 * aria-label (title, code, mastery state); the Tree view in MasteryMap
 * remains the primary screen-reader-friendly surface — this component is the
 * visual overview, not the only path to the information.
 */
import { useMemo } from "react";
import type { LearnerNodeWithStateView, LearnerPrerequisiteEdgeView } from "@/lib/types";

const NODE_W = 216;
const NODE_H = 40;
const COL_W = 264;
const ROW_H = 58;
const PAD = 16;

const bandClass: Record<string, string> = {
  LOW: "text-rose-600 dark:text-rose-400",
  DEVELOPING: "text-amber-600 dark:text-amber-400",
  SECURE: "text-emerald-600 dark:text-emerald-400",
};

const bandDot: Record<string, string> = {
  LOW: "bg-rose-500",
  DEVELOPING: "bg-amber-500",
  SECURE: "bg-emerald-500",
};

interface Positioned {
  node: LearnerNodeWithStateView;
  depth: number;
  x: number;
  y: number;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function ariaLabel(n: LearnerNodeWithStateView): string {
  const state =
    n.effectiveMastery === null
      ? "not practised"
      : `mastery ${Math.round(n.effectiveMastery * 100)} percent, ${n.band?.toLowerCase() ?? "unknown band"}`;
  const review = n.reviewDueAt ? `, review ${n.reviewReason?.toLowerCase() ?? "due"}` : "";
  return `${n.type.toLowerCase()} ${n.title} (${n.code}), ${state}${review}`;
}

function computeLayout(
  nodes: LearnerNodeWithStateView[],
  rootId: string,
): { positioned: Map<string, Positioned>; width: number; height: number } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rendered = new Set(
    nodes.filter((n) => n.type !== "MISCONCEPTION").map((n) => n.id),
  );
  const yById = new Map<string, number>();
  const depthById = new Map<string, number>();
  const slotByDepth: number[] = [];

  // leaf nodes take the next slot in their column; parents centre over children
  const placed = new Set<string>(); // cycle/diamond guard — see place()
  const place = (id: string, depth: number): number => {
    if (placed.has(id)) return yById.get(id) ?? 0;
    placed.add(id);
    depthById.set(id, depth);
    const node = byId.get(id);
    const childIds = (node?.childIds ?? []).filter(
      (cid) => byId.has(cid) && rendered.has(cid),
    );
    if (childIds.length === 0) {
      const slot = slotByDepth[depth] ?? 0;
      slotByDepth[depth] = slot + 1;
      const y = slot * ROW_H;
      yById.set(id, y);
      return y;
    }
    const childYs = childIds.map((cid) => place(cid, depth + 1));
    const mean = childYs.reduce((a, b) => a + b, 0) / childYs.length;
    yById.set(id, mean);
    return mean;
  };
  if (byId.has(rootId)) place(rootId, 0);

  const positioned = new Map<string, Positioned>();
  for (const n of nodes) {
    if (!rendered.has(n.id) || !depthById.has(n.id)) continue;
    positioned.set(n.id, {
      node: n,
      depth: depthById.get(n.id)!,
      x: depthById.get(n.id)! * COL_W + PAD,
      y: yById.get(n.id) ?? 0,
    });
  }

  // de-collision sweep per column (parents centred by mean can drift onto leaves)
  const byDepth = new Map<number, Positioned[]>();
  for (const p of positioned.values()) {
    const list = byDepth.get(p.depth) ?? [];
    list.push(p);
    byDepth.set(p.depth, list);
  }
  for (const list of byDepth.values()) {
    list.sort((a, b) => a.y - b.y);
    let prevY = -Infinity;
    for (const p of list) {
      if (p.y < prevY + NODE_H + 12) p.y = prevY + NODE_H + 12;
      prevY = p.y;
    }
  }

  let maxY = PAD;
  for (const p of positioned.values()) maxY = Math.max(maxY, p.y + NODE_H);
  const maxDepth = Math.max(0, ...[...positioned.values()].map((p) => p.depth));
  return {
    positioned,
    width: (maxDepth + 1) * COL_W + PAD * 2,
    height: maxY + PAD,
  };
}

/** Cubic bezier from a node's right edge to another node's left edge. */
function hierarchyPath(parent: Positioned, child: Positioned): string {
  const x1 = parent.x + NODE_W;
  const y1 = parent.y + NODE_H / 2;
  const x2 = child.x;
  const y2 = child.y + NODE_H / 2;
  const dx = Math.max(24, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/**
 * Prerequisite curve: prerequisite → dependent. Forward (dependent is in a
 * later column) uses side ports; backward/lateral routes below both nodes so
 * the direction stays readable.
 */
function prerequisiteGeometry(
  prerequisite: Positioned,
  dependent: Positioned,
): { path: string; arrow: string } {
  const forward = dependent.x > prerequisite.x + NODE_W;
  if (forward) {
    const x1 = prerequisite.x + NODE_W;
    const y1 = prerequisite.y + NODE_H / 2;
    const x2 = dependent.x - 8;
    const y2 = dependent.y + NODE_H / 2;
    const dx = Math.max(24, (x2 - x1) / 2);
    const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
    // tangent at the endpoint: P3 - P2
    const angle = Math.atan2(y2 - y2, x2 - (x2 - dx));
    const arrow = arrowHead(x2, y2, angle);
    return { path, arrow };
  }
  const x1 = prerequisite.x + NODE_W / 2;
  const y1 = prerequisite.y + NODE_H;
  const x2 = dependent.x + NODE_W / 2;
  const y2 = dependent.y + NODE_H;
  const sag = Math.max(y1, y2) + 34;
  const path = `M ${x1} ${y1} C ${x1} ${sag}, ${x2} ${sag}, ${x2} ${y2 + 8}`;
  const angle = Math.atan2(y2 - sag, 0); // pointing up into the dependent's bottom edge
  const arrow = arrowHead(x2, y2 + 8, angle);
  return { path, arrow };
}

function arrowHead(x: number, y: number, angle: number): string {
  const size = 7;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tipX = x + dx * 2;
  const tipY = y + dy * 2;
  const baseX = x - dx * size;
  const baseY = y - dy * size;
  const nx = -dy * size * 0.55;
  const ny = dx * size * 0.55;
  return `M ${tipX} ${tipY} L ${baseX + nx} ${baseY + ny} L ${baseX - nx} ${baseY - ny} Z`;
}

export function KnowledgeGraphView({
  nodes,
  rootId,
  prerequisiteEdges,
  selectedId,
  onSelect,
}: {
  nodes: LearnerNodeWithStateView[];
  rootId: string;
  prerequisiteEdges: LearnerPrerequisiteEdgeView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { positioned, width, height } = useMemo(
    () => computeLayout(nodes, rootId),
    [nodes, rootId],
  );
  const edges = useMemo(
    () =>
      prerequisiteEdges
        .map((e) => {
          const from = positioned.get(e.prerequisiteId);
          const to = positioned.get(e.nodeId);
          if (!from || !to) return null;
          return { ...prerequisiteGeometry(from, to), key: `${e.prerequisiteId}->${e.nodeId}` };
        })
        .filter((e): e is { path: string; arrow: string; key: string } => e !== null),
    [prerequisiteEdges, positioned],
  );

  const hierarchy = useMemo(() => {
    const list: { path: string; key: string }[] = [];
    for (const p of positioned.values()) {
      for (const cid of p.node.childIds) {
        const child = positioned.get(cid);
        if (child) list.push({ path: hierarchyPath(p, child), key: `${p.node.id}->${cid}` });
      }
    }
    return list;
  }, [positioned]);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border bg-muted/20">
        <svg
          role="img"
          width={Math.max(width, 320)}
          height={height}
          viewBox={`0 0 ${Math.max(width, 320)} ${height}`}
          className="block"
          aria-label="Knowledge graph overview: nodes coloured by mastery band, solid edges show structure, dashed edges show prerequisites"
        >
          {hierarchy.map((e) => (
            <path
              key={`h-${e.key}`}
              d={e.path}
              fill="none"
              style={{ stroke: "var(--muted-foreground)" }}
              strokeOpacity={0.35}
              strokeWidth={1}
            />
          ))}
          {edges.map((e) => (
            <g key={`p-${e.key}`}>
              <path
                d={e.path}
                fill="none"
                style={{ stroke: "var(--primary)" }}
                strokeOpacity={0.85}
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
              <path d={e.arrow} style={{ fill: "var(--primary)" }} fillOpacity={0.9} />
            </g>
          ))}
          {[...positioned.values()].map((p) => {
            const n = p.node;
            const selected = n.id === selectedId;
            const cls = n.band ? (bandClass[n.band] ?? "") : "text-muted-foreground";
            return (
              <g
                key={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
                aria-label={ariaLabel(n)}
                className={`cursor-pointer outline-none focus-visible:opacity-100 ${cls}`}
                onClick={() => onSelect(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(n.id);
                  }
                }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="currentColor"
                  fillOpacity={selected ? 0.22 : 0.08}
                  stroke="currentColor"
                  strokeWidth={selected ? 2 : 1}
                  strokeOpacity={selected ? 1 : 0.6}
                />
                <text
                  x={12}
                  y={17}
                  fontSize={11}
                  fontWeight={n.type === "SUBJECT" || n.type === "UNIT" ? 600 : 500}
                  style={{ fill: "var(--foreground)" }}
                >
                  {truncate(n.title, 26)}
                </text>
                <text x={12} y={31} fontSize={9} style={{ fill: "var(--muted-foreground)" }}>
                  {n.code}
                  {n.effectiveMastery !== null
                    ? ` · ${Math.round(n.effectiveMastery * 100)}%`
                    : ""}
                  {n.type === "MISCONCEPTION" ? " · misconception" : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${bandDot.SECURE}`} aria-hidden="true" />
          secure
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${bandDot.DEVELOPING}`} aria-hidden="true" />
          developing
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${bandDot.LOW}`} aria-hidden="true" />
          low
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden="true" />
          not practised
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true" className="shrink-0">
            <path
              d="M 1 4 C 8 4, 14 4, 17 4"
              fill="none"
              style={{ stroke: "var(--primary)" }}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          </svg>
          requires (prerequisite)
        </span>
        <span>solid = part of</span>
      </div>
    </div>
  );
}
