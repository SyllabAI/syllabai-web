/**
 * KGX layout — generic port of the v75 anchored-radial placement.
 *
 * The reference hard-codes four Edexcel section anchors and ring offsets;
 * this version derives the same shape from ANY hierarchy: the root sits at
 * the center, each level fans out on rings around its parent, and angular
 * allocation is proportional to subtree size so bigger branches get wider
 * arcs. The positions are HOME anchors — the engine's relaxation simulation
 * (home spring + collision + edge springs) refines them at runtime, exactly
 * like the reference's `simulationTick`.
 */
import type { KGXGraph, KGXNode } from "./types";

export interface AnchoredNode extends KGXNode {
  homeX: number;
  homeY: number;
}

const RING_RADIUS: Record<string, number> = {
  ROOT: 0,
  UNIT: 250,
  TOPIC: 150,
  SUBTOPIC: 110,
  SPEC: 78,
  MISCONCEPTION: 42,
  QUESTION: 95,
  LEARNER: 130,
  PAPER: 300,
};

function radiusFor(type: string, depth: number): number {
  if (RING_RADIUS[type] != null && !(type === "MISCONCEPTION" && depth <= 1)) {
    return RING_RADIUS[type];
  }
  return Math.max(60, 150 - depth * 18);
}

/** children grouped by parentId, preserving input order */
function childrenByParent(nodes: KGXNode[]): Map<string | null, KGXNode[]> {
  const map = new Map<string | null, KGXNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const arr = map.get(key);
    if (arr) arr.push(n);
    else map.set(key, [n]);
  }
  return map;
}

/** count of nodes in the subtree rooted at id (inclusive) */
function subtreeSizes(nodes: KGXNode[]): Map<string, number> {
  const children = childrenByParent(nodes);
  const size = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>(); // cycle guard — adapters come from trusted-but-external read models
  const visit = (id: string): number => {
    if (size.has(id)) return size.get(id)!;
    if (seen.has(id)) return 1; // defensive: a malformed cycle counts the node once
    seen.add(id);
    let total = 1;
    for (const c of children.get(id) ?? []) total += visit(c.id);
    seen.delete(id);
    size.set(id, total);
    return total;
  };
  for (const n of nodes) if (byId.has(n.id)) visit(n.id);
  return size;
}

/**
 * Compute home anchors for the whole forest. Multiple roots are laid out on
 * a horizontal line (the class lens can produce a parentless set).
 */
export function computeAnchors(graph: KGXGraph): AnchoredNode[] {
  const { nodes } = graph;
  const children = childrenByParent(nodes);
  const sizes = subtreeSizes(nodes);
  const anchored = new Map<string, AnchoredNode>();

  const roots = children.get(null) ?? [];
  const rootXs = roots.map((_, i) => (i - (roots.length - 1) / 2) * 700);

  const place = (node: KGXNode, x: number, y: number, depth: number, angle0: number, angle1: number) => {
    anchored.set(node.id, { ...node, homeX: x, homeY: y });
    const kids = children.get(node.id) ?? [];
    if (!kids.length) return;
    // misconception children hug their parent tightly (short local ring)
    const allMisconceptions = kids.every((k) => k.type === "MISCONCEPTION");
    const r =
      allMisconceptions && node.type !== "ROOT"
        ? 46
        : radiusFor(node.type === "ROOT" ? "UNIT" : node.type, depth);
    const total = kids.reduce((sum, k) => sum + Math.max(1, sizes.get(k.id) ?? 1), 0);
    let a = angle0;
    for (const k of kids) {
      const span = ((angle1 - angle0) * Math.max(1, sizes.get(k.id) ?? 1)) / total;
      const mid = a + span / 2;
      // MISCONCEPTION nodes: small alternating offsets so a cluster of them
      // forms a readable collar instead of a line
      if (k.type === "MISCONCEPTION") {
        const idx = kids.indexOf(k);
        const jitter = ((idx % 5) - 2) * 0.16;
        const kr = 40 + (idx % 3) * 14;
        anchored.set(k.id, {
          ...k,
          homeX: x + Math.cos(mid + jitter) * kr,
          homeY: y + Math.sin(mid + jitter) * kr * 0.8,
        });
        a += span;
        continue;
      }
      const kx = x + Math.cos(mid) * r;
      const ky = y + Math.sin(mid) * r * 0.82; // slight vertical squash like the reference
      place(k, kx, ky, depth + 1, a + span * 0.06, a + span * 0.94);
      a += span;
    }
  };

  roots.forEach((root, i) => place(root, rootXs[i], 0, 0, -Math.PI, Math.PI));

  // orphan nodes (parentId pointing at a missing node): ring the origin so
  // they are never rendered at (0,0) stacked
  let orphanIdx = 0;
  for (const n of nodes) {
    if (anchored.has(n.id)) continue;
    const ang = (orphanIdx / Math.max(1, nodes.length)) * Math.PI * 2;
    anchored.set(n.id, {
      ...n,
      homeX: Math.cos(ang) * 520,
      homeY: Math.sin(ang) * 420,
    });
    orphanIdx += 1;
  }

  return nodes.map((n) => anchored.get(n.id)!);
}
