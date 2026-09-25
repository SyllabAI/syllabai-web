import type { ExamQuestionUnit } from "@/lib/exam-families";
import type { SpecPointApplicability } from "@/lib/types";

/**
 * Spec-point applicability — presentation + scope semantics (T-C25, Phase 2
 * step 2). The DATA is core's (T-C24/V39): the official paper/unit/tier scope
 * of a specification point, verbatim from the seeded store. This module ports
 * the syllabai-demo reference implementation's presentation rules verbatim
 * (specification explorer, T-KG-16/17) and applies them to whole questions:
 * the ONE owner of labels, facet collection and match semantics, so every
 * consumer renders the same truth the same way. Nothing here invents scope —
 * an absent applicability stays absent everywhere.
 */

/** "1C" → "Paper 1C"; "4MA1/1F" passes through verbatim. */
export function paperLabel(p: string): string {
  return p.length <= 4 ? `Paper ${p}` : p;
}

/** "U1" → "Unit 1"; "U1F" → "Unit 1 (Foundation)"; others verbatim. */
export function unitLabel(u: string): string {
  const m = /^U(\d+)([FH])?$/.exec(u);
  if (!m) return u;
  const tier = m[2] === "F" ? " (Foundation)" : m[2] === "H" ? " (Higher)" : "";
  return `Unit ${m[1]}${tier}`;
}

/** The pseudo-paper the demo joins coursework-only points under (its
 *  exam-questions index rule, verbatim). Only surfaces when the payload
 *  actually carries coursework — never synthesized. */
export const COURSEWORK_PSEUDO = "__coursework__";

export interface ScopeOption {
  value: string;
  label: string;
}

export interface ScopeFacets {
  paperOptions: ScopeOption[];
  unitOptions: ScopeOption[];
  tierOptions: ScopeOption[];
  /** whole questions carrying at least one applicability-bearing spec point */
  scopedUnits: number;
}

const ALL = "__all__";

/** sentinel shared with the view — "no restriction on this dimension" */
export const SCOPE_ALL = ALL;

function sortOptions(map: Map<string, string>): ScopeOption[] {
  return [...map.entries()]
    .sort((x, y) => x[1].localeCompare(y[1], undefined, { numeric: true }))
    .map(([value, label]) => ({ value, label }));
}

function labelFor(value: string): string {
  return value === COURSEWORK_PSEUDO ? "Coursework" : paperLabel(value);
}

/** Paper/unit/tier facet options across a topic's whole questions — the demo's
 *  option derivation (spec explorer) over the demo's question-side join
 *  (exam-questions index): every part's every mapped spec point contributes. */
export function collectScopeFacets(units: ExamQuestionUnit[]): ScopeFacets {
  const papers = new Map<string, string>();
  const unitsScope = new Map<string, string>();
  const tiers = new Map<string, string>();
  let scopedUnits = 0;

  for (const u of units) {
    let scoped = false;
    for (const part of u.parts) {
      for (const ref of part.specPoints ?? []) {
        const a = ref.applicability;
        if (!a) continue;
        scoped = true;
        for (const p of a.papers ?? []) papers.set(p, labelFor(p));
        if ((a.papers ?? []).length === 0 && a.coursework) {
          papers.set(COURSEWORK_PSEUDO, "Coursework");
        }
        if (a.unit_scope) unitsScope.set(a.unit_scope, unitLabel(a.unit_scope));
        if (a.tier) tiers.set(a.tier, a.tier);
      }
    }
    if (scoped) scopedUnits += 1;
  }

  return {
    paperOptions: sortOptions(papers),
    unitOptions: sortOptions(unitsScope),
    tierOptions: sortOptions(tiers),
    scopedUnits,
  };
}

/** One spec-point applicability against the active scope (demo `matches`,
 *  verbatim): no active restriction → everything matches; an unscoped point
 *  never matches an active restriction. */
export function applicabilityMatches(
  a: SpecPointApplicability | null | undefined,
  paper: string,
  unitScope: string,
  tier: string,
): boolean {
  if (paper === ALL && unitScope === ALL && tier === ALL) return true;
  if (!a) return false;
  if (paper !== ALL) {
    const papers = a.papers ?? [];
    if (!papers.includes(paper) && !(paper === COURSEWORK_PSEUDO && papers.length === 0 && a.coursework)) {
      return false;
    }
  }
  if (unitScope !== ALL && a.unit_scope !== unitScope) return false;
  if (tier !== ALL && a.tier !== tier) return false;
  return true;
}

/** Whole-question scope check (the demo's set-join semantics): a question is
 *  in scope when ANY of its parts' mapped spec points carries a matching
 *  applicability. */
export function unitMatchesScope(
  unit: ExamQuestionUnit,
  paper: string,
  unitScope: string,
  tier: string,
): boolean {
  if (paper === ALL && unitScope === ALL && tier === ALL) return true;
  for (const part of unit.parts) {
    for (const ref of part.specPoints ?? []) {
      if (applicabilityMatches(ref.applicability, paper, unitScope, tier)) return true;
    }
  }
  return false;
}

/** Chips for one applicability object (demo `chipsFor`, verbatim). */
export function scopeChips(app: SpecPointApplicability): string[] {
  const chips: string[] = [];
  for (const p of app.papers ?? []) chips.push(paperLabel(p));
  if (app.unit_scope) chips.push(unitLabel(app.unit_scope));
  if (app.tier) chips.push(app.tier);
  if (app.coursework) chips.push("Coursework (internally assessed)");
  if (app.double_award_shared) chips.push("Also in Double Award");
  return chips;
}
