/**
 * pdf-lines — pure line model over pdf.js text items (CLIENT-SAFE, no pdf.js
 * import, no DOM). Powers everything textual in the past-papers viewer:
 *
 *   - Ctrl+F search: findInLines over per-page PdfLine[]
 *   - find highlights: matchRects interpolates char positions inside items
 *   - question-structure detection (ms-questions.ts) for per-question mock
 *     scoring and question jump — the LAZY alternative to a repo-wide
 *     question index (extract per paper, at view time, cache client-side).
 *
 * Geometry convention: items arrive already transformed into CSS viewport
 * units for a chosen scale (see PdfPane.linesFor — pdf.js
 * Util.transform(viewport.transform, item.transform), width = item.width *
 * scale). All coordinates are y-down (screen space), y is the BASELINE.
 */

export interface ItemGeom {
  str: string;
  /** left edge */
  x: number;
  /** baseline y */
  y: number;
  /** font height (approximate) */
  h: number;
  /** advance width */
  w: number;
}

export interface LineItem {
  str: string;
  x0: number;
  x1: number;
}

export interface PdfLine {
  page: number;
  /** baseline y */
  y: number;
  /** font height */
  h: number;
  x0: number;
  x1: number;
  /** items joined with heuristic spaces — the searchable text */
  text: string;
  items: LineItem[];
  /** char offset in `text` where each item starts (parallel to items) */
  starts: number[];
}

/**
 * Group viewport-space text items into visual lines (baseline proximity),
 * ordered left→right. The gap-to-space heuristic (gap > 0.2 × font height)
 * reconstructs word boundaries pdf.js drops between items — needed so that
 * queries like "sodium chloride" match across item boundaries.
 */
export function buildLines(geoms: ItemGeom[], page: number): PdfLine[] {
  const usable = geoms.filter((g) => g.str.length > 0 && g.h > 0);
  if (usable.length === 0) return [];
  const sorted = [...usable].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: ItemGeom[][] = [];
  let cur: ItemGeom[] = [];
  for (const g of sorted) {
    const prev = cur[cur.length - 1];
    if (prev && Math.abs(g.y - prev.y) <= Math.max(2, Math.max(prev.h, g.h) * 0.4)) {
      cur.push(g);
    } else {
      if (cur.length > 0) groups.push(cur);
      cur = [g];
    }
  }
  if (cur.length > 0) groups.push(cur);

  const lines: PdfLine[] = [];
  for (const grp of groups) {
    grp.sort((a, b) => a.x - b.x);
    const items: LineItem[] = [];
    const starts: number[] = [];
    let text = "";
    for (const g of grp) {
      const x0 = g.x;
      const x1 = g.x + g.w;
      if (items.length > 0) {
        const gap = x0 - items[items.length - 1].x1;
        const needsSpace = gap > g.h * 0.2 && !/\s$/.test(text) && !/^\s/.test(g.str);
        if (needsSpace) text += " ";
      }
      starts.push(text.length);
      text += g.str;
      items.push({ str: g.str, x0, x1 });
    }
    lines.push({
      page,
      y: grp[0].y,
      h: Math.max(...grp.map((g) => g.h)),
      x0: items[0].x0,
      x1: items[items.length - 1].x1,
      text,
      items,
      starts,
    });
  }
  return lines;
}

// ── find ─────────────────────────────────────────────────────────────────────

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive, whitespace-flexible query regex ("q 4" hits "Q4"). */
export function findRegex(query: string): RegExp {
  return new RegExp(escapeRegExp(query.trim()).replace(/\s+/g, "\\s+"), "gi");
}

export interface LineHit {
  lineIdx: number;
  start: number;
  end: number;
}

/** All hits of `re` across the document's lines (re is reset per line). */
export function findInLines(lines: PdfLine[], re: RegExp): LineHit[] {
  const hits: LineHit[] = [];
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[i].text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      hits.push({ lineIdx: i, start: m.index, end: m.index + m[0].length });
    }
  }
  return hits;
}

// ── highlight geometry ───────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Highlight rects for [start, end) inside one line. Char positions are
 * interpolated inside the owning item by char fraction — approximate for
 * proportional fonts, exact enough for mark-scheme/question typesetting.
 * A match spanning several items yields one rect per item (union boxes).
 */
export function matchRects(line: PdfLine, start: number, end: number): Rect[] {
  const rects: Rect[] = [];
  const yTop = line.y - line.h * 0.82;
  const hh = line.h * 1.12;
  for (let i = 0; i < line.items.length; i++) {
    const it = line.items[i];
    const s0 = line.starts[i];
    const s1 = s0 + it.str.length;
    if (s1 <= start || s0 >= end) continue;
    const a = Math.max(0, start - s0);
    const b = Math.min(it.str.length, end - s0);
    if (b <= a) continue;
    const width = Math.max(0, it.x1 - it.x0);
    const xA = it.x0 + width * (a / it.str.length);
    const xB = it.x0 + width * (b / it.str.length);
    rects.push({ x: xA, y: yTop, w: Math.max(2, xB - xA), h: hh });
  }
  return rects;
}
