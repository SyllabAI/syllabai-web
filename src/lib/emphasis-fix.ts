/**
 * Corpus emphasis normalizer — bold-marker repair for SME-derived content.
 *
 * Research finding (2026-09-19): the upstream HTML→markdown conversion often
 * leaves the authoring side's spacing INSIDE the bold delimiters. CommonMark
 * requires the opening `**` to be followed by non-whitespace and the closing
 * `**` to be preceded by non-whitespace, so markers like these render as
 * literal asterisks on the page:
 *
 *   ** two **      (ICT: "State** two **other types of utility software")
 *   **W **         (chemistry MCQ choice: "**W **and **Y**")
 *   ** Z**         (chemistry MCQ choice: "**X** and** Z**")
 *   **                    **   (mechanics: stray figure/answer-line artifact)
 *
 * Corpus audit: 17,524 question parts and 39 notes files carry at least one
 * space-flanked segment; 3,099 `** … **` (whitespace-flanked) segments exist
 * in questions alone. SME renders all of these as bold — parity demands the
 * same here.
 *
 * normalizeCorpusEmphasis repairs them at the text level, OUTSIDE `$…$` /
 * `$$…$$` math spans (44 math segments contain a literal `*` that must stay
 * untouched — KaTeX owns everything between the dollars), outside fenced
 * code blocks and outside inline code spans.
 *
 * Algorithm per paragraph (emphasis never crosses blank lines), verified
 * against the real remark pipeline on corpus samples:
 *
 *   1. runs of 3+ asterisks collapse to exactly two (`*****g*****` → `**g**`);
 *      no bare `***` thematic rules exist in the corpus (verified);
 *   2. `**` runs are paired with CommonMark's own rules for `**` (a run can
 *      open iff left-flanking, close iff right-flanking; right-flanking
 *      closes the nearest open run). These CLAIMED pairs render today, so
 *      their markers stay verbatim;
 *   3. runs the stack could NOT claim are converter artifacts. Leftovers are
 *      paired greedily in order and repaired — every rewrite turns literal
 *      asterisks into real bold:
 *        - whitespace-only pairs (`** **`) collapse to a single space;
 *        - edge whitespace is trimmed and re-inserted OUTSIDE the delimiter
 *          when the neighbouring outer character is alphanumeric (never
 *          doubling an existing space):
 *              State** two **other → State **two** other
 *              **W **and           → **W** and
 *              **X** and** Z**     → **X** and **Z**
 *        - an opener CommonMark rejects (e.g. "place**; …") or a closer it
 *          rejects (radical notation "**·**H") is detached with one space;
 *      leftover pairs whose inner still contains other `**` runs are NOT
 *      rewritten (too speculative) — their markers become deletion
 *      candidates, as do unpaired stray runs. A run is deleted only when at
 *      least one neighbour is whitespace/edge (both-alnum neighbours mean a
 *      possible exponent like 2**3 — content — and are preserved);
 *   4. the paragraph is re-normalized to a fixed point (≤3 passes) so repairs
 *      nested inside claimed spans take effect on the next pass.
 *
 * Single-asterisk *italic* is deliberately left alone: 31k+ candidate spans
 * in the corpus are prose multiplication signs and list artifacts, unsafe to
 * rewrite. Mixed `*…**…*` converter slop is a documented known limitation.
 */

const MATH_SPLIT = /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g;
// inline code spans — require non-empty content so a fence's ``` markers
// are never mistaken for an empty `…` span
const CODE_SPLIT = /`[^`\n]+`/g;

export function normalizeCorpusEmphasis(src: string): string {
  if (!src.includes("**")) return src;

  let out = "";
  let last = 0;
  const protectedRE = new RegExp(
    `${MATH_SPLIT.source}|${CODE_SPLIT.source}`,
    "g",
  );
  for (const m of src.matchAll(protectedRE)) {
    const start = m.index ?? 0;
    out += fixText(src.slice(last, start)) + m[0];
    last = start + m[0].length;
  }
  out += fixText(src.slice(last));
  return out;
}

/** Split off fenced code blocks, normalize only the prose between them. */
function fixText(text: string): string {
  if (!text.includes("**")) return text;

  const lines = text.split("\n");
  let inFence = false;
  const chunks: string[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) {
      chunks.push(fixProse(prose.join("\n")));
      prose = [];
    }
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      chunks.push(line);
      inFence = !inFence;
      continue;
    }
    if (inFence) chunks.push(line);
    else prose.push(line);
  }
  flush();
  return chunks.join("\n");
}

/** Split into paragraphs (emphasis never pairs across blank lines). */
function fixProse(text: string): string {
  const collapsed = text.replace(/\*{3,}/g, "**");
  if (!collapsed.includes("**")) return collapsed;

  const parts = collapsed.split(/(\n[ \t]*\n)/);
  for (let i = 0; i < parts.length; i += 2) {
    if (!parts[i].includes("**")) continue;
    for (let pass = 0; pass < 3; pass++) {
      const next = fixParagraph(parts[i]);
      if (next === parts[i]) break;
      parts[i] = next;
    }
  }
  return parts.join("");
}

type Run = {
  start: number;
  end: number;
  canOpen: boolean;
  canClose: boolean;
};

const ALNUM = /[\p{L}\p{N}]/u;

function fixParagraph(text: string): string {
  const runs: Run[] = [];
  for (const m of text.matchAll(/\*\*/g)) {
    const start = m.index;
    const end = start + 2;
    const prev = start > 0 ? text[start - 1] : "";
    const next = end < text.length ? text[end] : "";
    const prevWs = prev === "" || /\s/.test(prev);
    const nextWs = next === "" || /\s/.test(next);
    const prevPunct = prev !== "" && !ALNUM.test(prev) && !/\s/.test(prev);
    const nextPunct = next !== "" && !ALNUM.test(next) && !/\s/.test(next);
    // CommonMark flanking definitions (spec §6.2)
    const leftFlanking = !nextWs && (!nextPunct || prevWs || prevPunct);
    const rightFlanking = !prevWs && (!prevPunct || nextWs || nextPunct);
    // Rules 11/12 — for `**` there is no intraword restriction
    runs.push({ start, end, canOpen: leftFlanking, canClose: rightFlanking });
  }
  if (runs.length < 2) return text;

  // Pass 1 — claim every pair CommonMark itself can render.
  const stack: number[] = [];
  const claimed = new Set<number>();
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].canClose && stack.length > 0) {
      claimed.add(stack.pop() as number);
      claimed.add(i);
    } else if (runs[i].canOpen) {
      stack.push(i);
    }
  }

  // Pass 2 — leftover runs are converter artifacts; repair greedily.
  const leftovers = runs
    .map((_, i) => i)
    .filter((i) => !claimed.has(i))
    .sort((a, b) => runs[a].start - runs[b].start);

  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];
  const alnumBefore = (i: number) =>
    runs[i].start > 0 && ALNUM.test(text[runs[i].start - 1]);
  const alnumAfter = (i: number) =>
    runs[i].end < text.length && ALNUM.test(text[runs[i].end]);

  const runIndexesInside = (from: number, to: number) =>
    runs.some((r, k) => !claimed.has(k) && r.start > from && r.end < to);

  for (let k = 0; k + 1 < leftovers.length; k += 2) {
    const a = leftovers[k];
    const b = leftovers[k + 1];
    const open = runs[a];
    const close = runs[b];
    const inner = text.slice(open.end, close.start);
    const core = inner.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");

    if (runIndexesInside(open.end, close.start)) {
      // inner still carries other `**` runs — rewriting the pair would nest
      // markers inside markers; drop both markers instead (guarded below)
      continue;
    }
    if (!core) {
      edits.push({ start: open.start, end: close.end, text: " " });
    } else if (core !== inner) {
      // edge-whitespace pair — trim, re-insert one space outward only when
      // the neighbouring outer character is alphanumeric (word separator
      // preservation: "**W **and" must become "**W** and", not "**W**and")
      const pre = alnumBefore(a) ? " " : "";
      const post = alnumAfter(b) ? " " : "";
      edits.push({ start: open.start, end: close.end, text: `${pre}**${core}**${post}` });
    } else if (!open.canOpen || !close.canClose) {
      // CommonMark rejects a side ("place**; …" opener after an alnum char,
      // radical notation "**·**H" closer before one) — detach that side
      const pre = !open.canOpen && alnumBefore(a) ? " " : "";
      const post = !close.canClose && alnumAfter(b) ? " " : "";
      edits.push({ start: open.start, end: close.end, text: `${pre}**${core}**${post}` });
    } else {
      // renderable pair that merely went unclaimed — leave the markers
      continue;
    }
    claimed.add(a);
    claimed.add(b);
    // mark consumed so the odd-tail deletion below skips paired runs
    leftovers[k] = -1;
    leftovers[k + 1] = -1;
  }

  // Pass 3 — unpaired stray runs: delete when visually safe. Both-alnum
  // neighbours mean a possible exponent (2**3) — content — keep it.
  for (const k of leftovers) {
    if (k < 0) continue;
    const run = runs[k];
    const prev = run.start > 0 ? text[run.start - 1] : "";
    const next = run.end < text.length ? text[run.end] : "";
    if (ALNUM.test(prev) && ALNUM.test(next)) continue;
    edits.push({ start: run.start, end: run.end, text: "" });
  }

  if (edits.length === 0) return text;
  edits.sort((x, y) => x.start - y.start);

  let out = "";
  let pos = 0;
  for (const e of edits) {
    if (e.start < pos) continue; // overlap guard
    out += text.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  out += text.slice(pos);
  return out;
}
