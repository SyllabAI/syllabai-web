/**
 * ms-questions — conservative question-structure detection from mark scheme /
 * question paper LINE MODELS (see pdf-lines.ts).
 *
 * WHY THIS EXISTS (design decision, PP-FIND-SCORE-3): per-question mock
 * scoring does NOT need a repo-wide "index of all questions from past
 * papers". Building one would mean parsing 5,038 QPs + 4,989 MSs offline —
 * fragile across 20+ specs (scanned papers yield no text at all, layouts
 * differ, and the corpus already contains misattributed PDFs) — and the
 * grading workflow doesn't need it: the student has the MS open beside them
 * and can see the structure. Instead we extract structure LAZILY, per paper,
 * at view time, from the same text index the Ctrl+F feature builds, cache it
 * client-side and label every result honestly ("auto-detected — check
 * totals"), falling back to plain manual rows whenever the heuristic is not
 * confident. If question-level navigation/practice is ever promoted to a real
 * feature, the right upgrade path is an incremental build-time derived index
 * over the browsable subset — not a big-bang parse of the whole archive.
 *
 * Everything here is pure and intentionally NOISY-REJECTING: a null return
 * is always better than a wrong question table.
 */
import type { PdfLine } from "./pdf-lines";

export interface QRow {
  /** e.g. "1", "2(a)", "3(b)(ii)" */
  label: string;
  /** marks available, when the right-column token was identified */
  max: number | null;
}

export interface QpQuestion {
  label: string;
  page: number;
}

/** Column captions / furniture that must never be read as content. */
const BOILERPLATE =
  /^(mark scheme|question|answer|marks?|total\b|total for|accept|reject|do not accept|allow|notes?\b|guidance|examiner|specimen|paper reference|turn over|confidence|interviews)/i;

/** "1", "12", "4 (a) …", "4 The chart shows …" — question-number line start. */
const NEW_Q = /^(\d{1,2})(?![.\d])(?:(?=\s*\()|\s+|$)/;

/** "(a)", "(iii)", "(2)" — part label line start. */
const PART = /^\((([a-z]{1,3})|([ivx]{1,5})|(\d{1,2}))\)/i;

/** Standalone marks token (right column) — 1..30. */
const MARKS_TOKEN = /^\d{1,2}$/;

interface PageBox {
  minX: number;
  maxX: number;
}

/** Per-page ink extents for left-margin / right-column tests. */
function pageBoxes(lines: PdfLine[]): Map<number, PageBox> {
  const boxes = new Map<number, PageBox>();
  for (const ln of lines) {
    const b = boxes.get(ln.page) ?? { minX: Number.POSITIVE_INFINITY, maxX: 0 };
    b.minX = Math.min(b.minX, ln.x0);
    b.maxX = Math.max(b.maxX, ln.x1);
    boxes.set(ln.page, b);
  }
  return boxes;
}

/** True when the line starts at the left margin (question/number column). */
function atLeftMargin(ln: PdfLine, box: PageBox): boolean {
  const width = Math.max(1, box.maxX - box.minX);
  return ln.x0 <= box.minX + width * 0.04;
}

/** True when the line's LAST item sits in the right-hand marks column.
 * Real Edexcel MSs right-align marks inside a column whose right edge sits
 * left of page furniture (the "PMT" watermark defines maxX on corpus scans),
 * so the right-edge tolerance is generous (15%) — generous enough for the
 * marks column, still rejecting mid-line integers ("any value from 5 to 7",
 * whose last item ends ~27% short of the right edge). */
function lastItemInMarksColumn(ln: PdfLine, box: PageBox): boolean {
  if (ln.items.length === 0) return false;
  const last = ln.items[ln.items.length - 1];
  const width = Math.max(1, box.maxX - box.minX);
  return last.x0 >= box.minX + width * 0.55 && last.x1 >= box.maxX - width * 0.15;
}

/**
 * Detect the question table of an Edexcel-style MARK SCHEME:
 * question-number column at the left margin, part labels "(a)", marks in a
 * right-hand column. Returns null when the extracted model is not confident.
 */
export function detectMsStructure(allLines: PdfLine[]): QRow[] | null {
  const boxes = pageBoxes(allLines);
  const rows: QRow[] = [];
  let curQ: number | null = null;
  /** first-level part of the open question, e.g. "a" — roman sub-parts continue it */
  let curPart1: string | null = null;
  let curRow: QRow | null = null;

  const pushCur = () => {
    if (curRow) rows.push(curRow);
    curRow = null;
  };

  const tryMarks = (line: PdfLine, box: PageBox, text: string) => {
    if (!curRow || curRow.max != null || /^total/i.test(text)) return;
    if (!lastItemInMarksColumn(line, box)) return;
    const tok = line.items[line.items.length - 1].str.trim();
    if (MARKS_TOKEN.test(tok)) {
      const v = Number(tok);
      if (v >= 1 && v <= 30) curRow.max = v;
    }
  };

  for (const raw of allLines) {
    const text = raw.text.trim();
    if (!text) continue;
    const box = boxes.get(raw.page);
    if (!box) continue;

    // marks token FIRST — guidance lines ("ALLOW correct formulae  5") are
    // boilerplate as ROW OPENERS but often CARRY the marks cell, so they must
    // not be skipped before the marks check. "Total" lines are excluded (the
    // question total must never be mistaken for the open row's max).
    tryMarks(raw, box, text);

    if (BOILERPLATE.test(text)) continue;

    const qm = NEW_Q.exec(text);
    const pm = PART.exec(text);
    const left = atLeftMargin(raw, box);

    if (qm && left && Number(qm[1]) >= 1) {
      // a new top-level question opens a new row; the part label ("1 (a) …")
      // and even a roman sub-part ("2 (a)(i) …") often share that first line
      pushCur();
      curQ = Number(qm[1]);
      curPart1 = null;
      let rest = text.slice(qm[0].length).trim();
      const sub = PART.exec(rest);
      let label = `${curQ}`;
      if (sub) {
        const isRoman = /^[ivx]+$/i.test(sub[1]);
        if (!isRoman) curPart1 = sub[1].toLowerCase();
        label = `${curQ}(${sub[1]})`;
        rest = rest.slice(sub[0].length).trim();
        const sub2 = PART.exec(rest);
        if (sub2) label += `(${sub2[1]})`;
      }
      curRow = { label, max: null };
    } else if (pm && left && curQ != null) {
      // part row ("(a)" / "(ii)" at the margin under the current question)
      pushCur();
      const isRoman = /^[ivx]+$/i.test(pm[1]);
      if (!isRoman) curPart1 = pm[1].toLowerCase();
      const base = isRoman && curPart1 ? `${curQ}(${curPart1})` : `${curQ}`;
      curRow = { label: `${base}(${pm[1]})`, max: null };
    }

    // the marks cell often shares the baseline with the row opener itself —
    // re-check the same line now that the fresh row is open
    tryMarks(raw, box, text);
  }
  pushCur();

  return plausible(rows) ? rows : null;
}

/** Plausibility gate — noisy-rejecting on purpose. */
function plausible(rows: QRow[]): boolean {
  if (rows.length < 2 || rows.length > 60) return false;
  if (!rows[0].label.startsWith("1")) return false;
  const withMax = rows.filter((r) => r.max != null);
  if (withMax.length < Math.ceil(rows.length * 0.6)) return false;
  const sum = withMax.reduce((a, r) => a + (r.max ?? 0), 0);
  if (sum <= 0 || sum > 400) return false;
  let lastQ = 0;
  for (const r of rows) {
    const q = Number(/^(\d{1,2})/.exec(r.label)?.[1] ?? "0");
    if (q < lastQ) return false; // numbering must be non-decreasing
    lastQ = q;
  }
  return true;
}

/**
 * Detect top-level questions in a QUESTION PAPER (for the mock overlay's
 * jump-to-question select): left-margin lines opening with "1", "4 (a) …".
 * Returns the FIRST page each question number appears on, or null.
 */
export function detectQpQuestions(allLines: PdfLine[]): QpQuestion[] | null {
  const boxes = pageBoxes(allLines);
  const byQ = new Map<number, QpQuestion>();
  for (const raw of allLines) {
    const text = raw.text.trim();
    if (!text || BOILERPLATE.test(text)) continue;
    const box = boxes.get(raw.page);
    if (!box) continue;
    if (!atLeftMargin(raw, box)) continue;
    const qm = NEW_Q.exec(text);
    if (!qm) continue;
    const q = Number(qm[1]);
    if (q < 1 || q > 25) continue;
    // reject prose that merely begins with a number ("2 marks available");
    // a real question line continues with "(", a digit or an UPPERCASE word
    // ("0.5 mol" is already excluded by NEW_Q's (?![.\d]))
    const rest = text.slice(qm[0].length).trim();
    const headerLike = rest.length === 0 || /^[A-Z0-9(]/.test(rest);
    if (!headerLike) continue;
    if (!byQ.has(q)) byQ.set(q, { label: `Q${q}`, page: raw.page });
  }
  const qs = [...byQ.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  if (qs.length < 3 || qs[0].label !== "Q1" || qs.length > 40) return null;
  // continuity: question numbers should reach at least 3 with no big gaps
  const maxQ = Math.max(...qs.map((q) => Number(q.label.slice(1))));
  if (maxQ < 3) return null;
  return qs;
}
