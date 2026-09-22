import type { StudentQuestionView } from "@/lib/types";

/**
 * Exam-question families (session-120).
 *
 * The SME corpus import (sme-corpus-import-v1, ADR-026) stored each SME
 * question as one row per MCQ part (`-pN` suffix) plus, for mixed questions,
 * one row for the structured section (`-s` suffix) — the syllabai-demo player
 * instead shows the WHOLE SME question (stimulus + every part) as one unit.
 * This module reconstructs that unit client-side, exactly like the demo's
 * bundle logic (build_bundles.py): one card per SME question, all parts
 * together, in SME page order, so a part tagged to a topic never renders
 * without its stimulus (the "substances P/Q/R/S table" defect).
 *
 * Verified against production (session-120 forensics):
 * - every part row of a family carries the SAME topic tags, so the
 *   topic-scoped list always contains the whole family;
 * - `qN` in the external ref equals the SME question's 0-based page order;
 * - 46 families are "mixed" (MCQ parts + a structured `-s` twin); for 23 of
 *   them the SME part order interleaves the structured section among the MCQs
 *   in a way the refs alone cannot express — those orders are pinned below,
 *   derived from the demo bundle built from the same corpus (member sets
 *   verified 1:1 against the production refs).
 */

/** SME part order for the interleaved families (suffix sequence per family
 * key). Families absent here use the default order: `-p1..pN` then `-s`. */
const FAMILY_PART_ORDER: Record<string, string[]> = {
  "sme-eq-1-1-states-of-matter-q16": ["-p1", "-s", "-p2"],
  "sme-eq-1-2-elements-compounds-and-mixtures-q18": ["-s", "-p1"],
  "sme-eq-1-2-elements-compounds-and-mixtures-q24": ["-s", "-p1"],
  "sme-eq-1-8-metallic-bonding-q3": ["-s", "-p1", "-p2"],
  "sme-eq-1-8-metallic-bonding-q4": ["-p1", "-s", "-p2"],
  "sme-eq-2-2-group-7-halogens-q16": ["-s", "-p1"],
  "sme-eq-2-4-reactivity-series-q4": ["-s", "-p1"],
  "sme-eq-2-4-reactivity-series-q18": ["-s", "-p1"],
  "sme-eq-2-5-extraction-and-uses-of-metals-q8": ["-s", "-p1"],
  "sme-eq-2-6-acids-alkalis-and-titrations-q11": ["-s", "-p1"],
  "sme-eq-2-7-acids-bases-and-salt-preparations-q3": ["-s", "-p1"],
  "sme-eq-3-3-reversible-reactions-and-equilibria-q3": ["-s", "-p1"],
  "sme-eq-3-3-reversible-reactions-and-equilibria-q4": ["-s", "-p1"],
  "sme-eq-4-2-crude-oil-q15": ["-s", "-p1"],
  "sme-eq-4-3-alkanes-q3": ["-s", "-p1", "-p2"],
  "sme-eq-4-4-alkenes-q4": ["-s", "-p1", "-p2"],
  "sme-eq-4-4-alkenes-q8": ["-s", "-p1"],
  "sme-eq-4-5-alcohols-q4": ["-s", "-p1"],
  "sme-eq-4-6-carboxylic-acids-q3": ["-p1", "-p2", "-s", "-p3"],
  "sme-eq-4-6-carboxylic-acids-q4": ["-s", "-p1"],
  "sme-eq-4-7-esters-q3": ["-s", "-p1"],
  "sme-eq-4-7-esters-q10": ["-s", "-p1"],
  "sme-eq-4-8-synthetic-polymers-q9": ["-s", "-p1"],
};

/** `sme-eq-<unit>-<n>-<slug>-q<N>` + optional `-p<M>` / `-s` suffix. */
const SME_REF_RE = /^(sme-eq-.*)-q(\d+)(-p(\d+)|-s)?$/;

/** One whole SME question: all its row-level parts, in SME order. */
export type ExamQuestionUnit = {
  /** family key — the external ref with the part suffix removed (row id for
   * rows outside the SME ref convention): stable id for scroll/save/bookmark */
  key: string;
  /** display ref (the family base, e.g. sme-eq-1-6-ionic-bonding-q1) */
  ref: string | null;
  /** member rows in SME part order (p1 carries the shared stimulus) */
  parts: StudentQuestionView[];
  /** sum of the member marks (the SME question's total marks) */
  marks: number;
  /** difficulty is uniform within a family (verified) — first part's */
  difficulty: number;
  /** "mcq" when every member is an MCQ row, else "structured" */
  type: "mcq" | "structured";
  /** true when the SME question was split into several rows */
  multi: boolean;
};

type RefParse = { family: string; suffix: string; source: string; qNum: number };

function parseRef(ref: string | null, rowId: string): RefParse {
  if (ref) {
    const m = ref.match(SME_REF_RE);
    if (m) {
      return {
        family: `${m[1]}-q${m[2]}`,
        suffix: m[3] ?? "",
        source: m[1],
        qNum: Number(m[2]),
      };
    }
  }
  // not an SME corpus ref: its own family, sorts after the corpus
  return { family: rowId, suffix: "", source: "\uffff", qNum: 0 };
}

/** numeric-aware slug compare: "1-10-x" sorts after "1-2-x" */
function compareSource(a: string, b: string): number {
  const sa = a.split("-");
  const sb = b.split("-");
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const x = sa[i];
    const y = sb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** SME member order for a family: pinned order if known, else the default
 * (plain row, then -p1..pN, then -s). */
function memberRank(family: string, suffix: string): number {
  const pinned = FAMILY_PART_ORDER[family];
  if (pinned) {
    const idx = pinned.indexOf(suffix);
    if (idx >= 0) return idx;
  }
  if (suffix === "") return -1;
  if (suffix === "-s") return 10_000;
  const m = suffix.match(/^-p(\d+)$/);
  return m ? 9000 + Number(m[1]) : 9500;
}

/** Group a topic's servable rows into whole SME questions, SME-page-ordered —
 * the demo's serving logic, client-side. */
export function buildQuestionUnits(rows: StudentQuestionView[]): ExamQuestionUnit[] {
  const byFamily = new Map<string, { row: StudentQuestionView; parse: RefParse }[]>();
  for (const row of rows) {
    const parse = parseRef(row.externalRef, row.id);
    let bucket = byFamily.get(parse.family);
    if (!bucket) {
      bucket = [];
      byFamily.set(parse.family, bucket);
    }
    bucket.push({ row, parse });
  }

  const units: ExamQuestionUnit[] = [];
  for (const [family, bucket] of byFamily) {
    bucket.sort((a, b) => memberRank(family, a.parse.suffix) - memberRank(family, b.parse.suffix));
    const parts = bucket.map((b) => b.row);
    const multi = bucket.length > 1 || bucket[0].parse.suffix !== "";
    units.push({
      key: family,
      ref: multi
        ? family
        : (bucket[0].row.externalRef ?? null),
      parts,
      marks: parts.reduce((sum, p) => sum + (p.marks ?? 0), 0),
      difficulty: parts[0].difficulty,
      type: parts.every((p) => p.type !== "STRUCTURED") ? "mcq" : "structured",
      multi,
    });
  }

  // SME page order: source topic, then question number (qN = 0-based order)
  units.sort((a, b) => {
    const pa = parseRef(a.ref ?? a.key, a.key);
    const pb = parseRef(b.ref ?? b.key, b.key);
    const bySource = compareSource(pa.source, pb.source);
    if (bySource !== 0) return bySource;
    if (pa.qNum !== pb.qNum) return pa.qNum - pb.qNum;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return units;
}

/** The bookmark key for a unit (the family base ref). */
export function savedKeysOfUnit(unit: ExamQuestionUnit): string[] {
  // include member row ids so bookmarks saved before families existed
  // (session-119 stored row ids) keep resolving
  return [unit.key, ...unit.parts.map((p) => p.id)];
}

export function unitIsSaved(unit: ExamQuestionUnit, savedIds: Set<string>): boolean {
  return savedKeysOfUnit(unit).some((k) => savedIds.has(k));
}

export function unitIsAttempted(unit: ExamQuestionUnit, attemptedIds: Set<string>): boolean {
  return unit.parts.some((p) => attemptedIds.has(p.id));
}
