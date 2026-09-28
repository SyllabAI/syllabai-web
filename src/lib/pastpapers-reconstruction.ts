/**
 * Reconstruction matching + coverage — shared by the Past Papers page, the
 * reconstruction player, and the offline blueprint builder (scripts/).
 *
 * Two honest layers:
 *   1. MATCHING — a reconstruction (questions grouped by sourcePaper) links
 *      to a corpus PDF row when parseReconstruction normalises both sides to
 *      the same session + unit + variant. First match wins (same as before —
 *      behaviour preserved from the page-local implementation).
 *   2. COVERAGE — pastpapers-blueprints.json holds the official per-question
 *      mark totals, extracted from the corpus QP PDFs ("Total for Question N
 *      = M marks", gaps inferred from the "TOTAL FOR PAPER" line). Coverage
 *      compares what the parsed corpus holds against that blueprint:
 *      complete / marks-differ / partial / unverified. It never pretends:
 *      papers without a blueprint stay "unverified".
 */
import type { PastPaper } from "@/lib/past-papers";
import blueprintsJson from "@/data/pastpapers-blueprints.json";

// ── matching ───────────────────────────────────────────────────────────────

export interface ReconstructionMatchTarget {
  sessionId: string;
  dir: string;
  unit: string;
  variant: string;
}

/**
 * Normalise a corpus reconstruction's sourcePaper metadata into corpus-match
 * keys. Returns null when the metadata is too thin to match honestly (e.g.
 * "Pre2017" with no paper number) — such rows just stay in the fallback
 * archive instead of pretending.
 */
export function parseReconstruction(
  date: string,
  number: string,
): { sessionIds: string[]; unit: string | null; variant: string } | null {
  const d = (date ?? "").trim();
  const n = (number ?? "").trim();
  if (!n) return null;
  // "Jun 2023 (R)" — Pearson regional variants are physically different papers
  // (4ET1-02R etc.), so the marker must carry into the matched dir, never
  // collapse onto the non-regional row.
  const regional = /\(\s*r\s*\)/i.test(d);

  const year = d.match(/\d{4}/)?.[0];
  const dl = d.toLowerCase();
  // "June 16" / "Jan 13" / "Nov 19" — 2-digit year shorthand for real sessions
  // (2011+ IGCSE/IAL era → 20yy). "Pre 17" stays unparseable: a range marker,
  // not a year.
  const shortYear =
    !year && !dl.includes("pre") ? d.match(/\b(\d{2})\b/)?.[1] : undefined;
  const yearNorm = year ?? (shortYear ? `20${shortYear}` : undefined);
  const months: string[] = [];
  if (dl.includes("jan")) months.push("01");
  if (dl.includes("jun") && !dl.includes("jan")) months.push("06");
  if (dl.includes("oct")) months.push("10");
  if (dl.includes("nov")) months.push("11");

  let unit: string | null = null;
  let variant: string | null = null;
  const ref = n.match(/^([A-Za-z0-9]+)\/([0-9A-Za-z]+)$/);
  if (ref) {
    // full official ref: "4CH1/1C", "WCH11/01"
    unit = ref[1].toUpperCase();
    // corpus metadata occasionally OCRs zero as letter O ("4EA1/O1") —
    // variants are digits + R/A suffixes, so normalise
    variant = ref[2].toUpperCase().replace(/O/g, "0");
  } else {
    // "Paper 1", "Paper 2: Section B" — business/econ/ICT/accounting style;
    // the paper ordinal maps onto the corpus's 01/02 dirs, unit comes from
    // the course context (never guessed here)
    const paper = n.match(/^Paper\s*([0-9]+)(R)?(?:\s*[:\-].*)?$/i);
    if (paper) {
      const ordinal = paper[1];
      variant =
        (ordinal.length >= 2 ? ordinal : `0${ordinal}`) +
        (paper[2]?.toUpperCase() ?? "");
    } else {
      // glued session prefix + paper code: "Ja1CR", "Jan1CR", "Ju1c", "1P"
      const m = n.match(/^(jan|jun|ja|ju|nov|oct)?\s*([0-9][0-9A-Za-z]*)$/i);
      if (!m) return null;
      variant = m[2].toUpperCase();
      const pref = m[1]?.toLowerCase();
      if (pref && months.length === 0) {
        if (pref === "jan" || pref === "ja") months.push("01");
        else if (pref === "jun" || pref === "ju") months.push("06");
        else if (pref === "oct") months.push("10");
        else if (pref === "nov") months.push("11");
      }
    }
  }
  if (!variant) return null;
  if (regional && !variant.endsWith("R")) variant += "R";

  const sessionIds: string[] = [];
  if (dl.includes("specimen")) {
    sessionIds.push("specimen");
  } else if (yearNorm) {
    if (months.length) for (const mm of months) sessionIds.push(`${yearNorm}-${mm}`);
    else for (const mm of ["01", "02", "06", "10", "11"]) sessionIds.push(`${yearNorm}-${mm}`);
  }
  // Without a year (or specimen) the session is unpinnable — matching ANY
  // session would pair a reconstruction with an arbitrary paper. Stay honest:
  // no parse rather than a guess.
  if (sessionIds.length === 0) return null;
  return { sessionIds, unit, variant };
}

export interface ReconstructionMatch {
  /** corpus `${sessionId}:${dir}` → reconstruction key */
  matchKeys: Map<string, string>;
  /** reconstruction keys that matched at least one corpus row */
  matchedReconKeys: Set<string>;
  /** corpus `${sessionId}:${dir}` → matched reconstruction (same as matchKeys values) */
  reconForCorpus: Map<string, PastPaper>;
}

/**
 * Match corpus paper rows against reconstructions. Mirrors the original
 * page-local loop exactly: first matching reconstruction wins per row.
 */
export function matchReconstructions<T extends ReconstructionMatchTarget>(
  papers: readonly T[],
  reconstructions: readonly PastPaper[],
): ReconstructionMatch {
  const matchKeys = new Map<string, string>();
  const matchedReconKeys = new Set<string>();
  const reconForCorpus = new Map<string, PastPaper>();
  for (const p of papers) {
    for (const r of reconstructions) {
      const parsed = parseReconstruction(r.date, r.number);
      if (!parsed) continue;
      if (parsed.unit && parsed.unit !== p.unit.toUpperCase()) continue;
      if (parsed.variant !== p.variant.toUpperCase()) continue;
      if (parsed.sessionIds.length > 0 && !parsed.sessionIds.includes(p.sessionId)) continue;
      const corpusKey = `${p.sessionId}:${p.dir}`;
      matchKeys.set(corpusKey, r.key);
      matchedReconKeys.add(r.key);
      reconForCorpus.set(corpusKey, r);
      break;
    }
  }
  return { matchKeys, matchedReconKeys, reconForCorpus };
}

// ── coverage ───────────────────────────────────────────────────────────────

/** One official paper's per-question mark totals, from the corpus QP PDF. */
export interface PaperBlueprint {
  /** question number (as string key, JSON) → official marks */
  marks: Record<string, number>;
  /** sum of the per-question marks */
  total: number;
  /** "TOTAL FOR PAPER = N MARKS" when the QP states it (cross-check / gap inference) */
  paperTotal: number | null;
  /** question numbers whose marks were inferred from the paper total (extraction gap) */
  inferred: string[];
  /** optional-choice paper ("answer two questions from..."): per-question
   *  footers legitimately exceed the paper total because students answer a
   *  subset — `total` is the full offered sum, `paperTotal` the answerable one */
  optional?: true;
}

interface BlueprintsFile {
  meta: { generatedAt: string; treeSha: string; papers: number; inferredGaps: number };
  papers: Record<string, PaperBlueprint>;
}

const blueprints = blueprintsJson as BlueprintsFile;

/** Blueprint for a corpus `${sessionId}:${dir}`, or null when not extracted. */
export function blueprintFor(corpusKey: string): PaperBlueprint | null {
  return blueprints.papers[corpusKey] ?? null;
}

export interface ReconstructionCoverage {
  state: "complete" | "marks-differ" | "partial" | "unverified";
  heldQuestions: number;
  officialQuestions: number;
  heldMarks: number;
  officialMarks: number;
  /** optional-choice paper: marks a student actually answers (paper total),
   *  null for normal papers where officialMarks already is that */
  officialAnswerableMarks: number | null;
  /** official question numbers the corpus does not hold */
  missing: number[];
  /** held question numbers that are not in the official paper */
  extra: number[];
  /** official question numbers with marks inferred from the paper total */
  inferred: number[];
}

/**
 * Compare a reconstruction against the official blueprint. Held marks are
 * summed per question number (corpus part-splits of one official question
 * legitimately sum to the official total). Any held entry without a question
 * number makes the set comparison impossible → "unverified".
 */
export function computeCoverage(
  paper: PastPaper,
  bp: PaperBlueprint | null | undefined,
): ReconstructionCoverage | null {
  if (!bp) return null;

  const heldMarksByQn = new Map<number, number>();
  let unknownQnCount = 0;
  let unknownQnMarks = 0;
  paper.questions.forEach((q, i) => {
    const qn = paper.questionNumbers[i] ?? null;
    const marks = q.totalMarks ?? 0;
    if (qn == null || !Number.isFinite(qn) || qn <= 0) {
      unknownQnCount++;
      unknownQnMarks += marks;
      return;
    }
    heldMarksByQn.set(qn, (heldMarksByQn.get(qn) ?? 0) + marks);
  });

  const officialQs = Object.keys(bp.marks)
    .map(Number)
    .sort((a, b) => a - b);
  const heldQs = [...heldMarksByQn.keys()].sort((a, b) => a - b);
  const missing = officialQs.filter((n) => !heldMarksByQn.has(n));
  const extra = heldQs.filter((n) => !bp.marks[String(n)]);
  const officialMarks = bp.total;
  const heldMarks = [...heldMarksByQn.values()].reduce((a, b) => a + b, 0) + unknownQnMarks;
  const officialAnswerableMarks = bp.optional === true ? bp.paperTotal : null;

  const inferred = bp.inferred.map(Number);

  if (unknownQnCount > 0) {
    return {
      state: "unverified",
      heldQuestions: heldQs.length + unknownQnCount,
      officialQuestions: officialQs.length,
      heldMarks,
      officialMarks,
      officialAnswerableMarks,
      missing,
      extra,
      inferred,
    };
  }
  if (missing.length === 0 && extra.length === 0) {
    return {
      state: heldMarks === officialMarks ? "complete" : "marks-differ",
      heldQuestions: heldQs.length,
      officialQuestions: officialQs.length,
      heldMarks,
      officialMarks,
      officialAnswerableMarks,
      missing,
      extra,
      inferred,
    };
  }
  return {
    state: "partial",
    heldQuestions: heldQs.length,
    officialQuestions: officialQs.length,
    heldMarks,
    officialMarks,
    officialAnswerableMarks,
    missing,
    extra,
    inferred,
  };
}

/** Short chip label, e.g. "10/10" or "6/7". Null when coverage is unknown. */
export function coverageChipLabel(c: ReconstructionCoverage | null): string | null {
  if (!c || c.state === "unverified") return null;
  return `${c.heldQuestions}/${c.officialQuestions}`;
}

/**
 * One-line human summary for tooltips / player badges. Honest per state:
 * complete = Q-set and marks both match; marks-differ = Q-set matches but the
 * parsed corpus allocates marks slightly differently; partial = questions are
 * missing; unverified = no official blueprint extracted for this paper.
 * Optional-choice papers say "offered" — per-question footers exceed what a
 * student answers, so the raw totals read differently.
 */
export function coverageTitle(c: ReconstructionCoverage): string {
  const q = `Q${c.missing.slice(0, 5).join(", Q")}${c.missing.length > 5 ? ` +${c.missing.length - 5} more` : ""}`;
  if (c.officialAnswerableMarks != null) {
    const marks = `${c.heldMarks}/${c.officialMarks} marks offered by the official paper (students answer ${c.officialAnswerableMarks})`;
    switch (c.state) {
      case "complete":
        return `Complete reconstruction — all ${c.officialQuestions} questions held, every optional-choice question included · ${marks}`;
      case "marks-differ":
        return `All ${c.officialQuestions} questions held · ${marks} — parsed marks differ slightly from the official paper`;
      case "partial":
        return `Partial reconstruction — ${c.heldQuestions} of ${c.officialQuestions} questions held${c.missing.length ? ` (missing ${q})` : ""} · ${marks}`;
      case "unverified":
        return `Reconstruction — ${c.heldQuestions} questions held; official paper totals unavailable for verification`;
    }
  }
  switch (c.state) {
    case "complete":
      return `Complete reconstruction — all ${c.officialQuestions} questions · ${c.heldMarks}/${c.officialMarks} marks match the official paper`;
    case "marks-differ": {
      // two honest flavours: near-total corpora with ±1 mark reallocations,
      // vs corpora that hold only some of every question's parts
      if (c.heldMarks < c.officialMarks * 0.85) {
        return `Every official question is represented, but the corpus holds only part of each — ${c.heldMarks} of ${c.officialMarks} marks' worth vs the official paper`;
      }
      return `All ${c.officialQuestions} questions held · ${c.heldMarks}/${c.officialMarks} marks — parsed marks differ slightly from the official paper`;
    }
    case "partial":
      return `Partial reconstruction — ${c.heldQuestions} of ${c.officialQuestions} questions held${c.missing.length ? ` (missing ${q})` : ""} · ${c.heldMarks}/${c.officialMarks} marks vs the official paper`;
    case "unverified":
      return `Reconstruction — ${c.heldQuestions} questions held; official paper totals unavailable for verification`;
  }
}
