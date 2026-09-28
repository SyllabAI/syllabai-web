/**
 * Forgetting-decay model — the demo's honest stand-in for the web workbench's
 * nightly Ebbinghaus job (KG phase 2).
 *
 * The web workbench stores measured mastery and derives "effective mastery"
 * by applying Ebbinghaus retention with τ = 30/90/365 days depending on the
 * proficiency band: strong memories fade slowest. This module ports the same
 * shape over the demo's browser-local progress store with plainly-commented
 * demo parameters:
 *
 *   retention(t) = e^(-t / τ)          (t = days since the last evidence)
 *   effective    = stored × retention  (rounded, floored at 0)
 *
 * A point is *review due* when its effective mastery decays below the band
 * threshold above where it was demonstrated — the same "schedules reviews
 * when mastery crosses the threshold" rule the web StateView describes:
 *
 *   - demonstrated ≥ 80 (strong)  → review when effective drops below 70
 *   - demonstrated  < 80          → review when effective drops below 55
 *   - demonstrated already below its own threshold → due immediately
 *
 * Everything here is arithmetic on numbers the learner generated; nothing is
 * invented, and the parameters are SIMULATED heuristics, not a science claim.
 */

/** Decay time-constants (days) by demonstrated band — demo parameters. */
export const DECAY_TAU_DAYS = { weak: 30, developing: 90, strong: 365 } as const;

/** Review thresholds — a strong point only needs review once it slips out of "good". */
export const REVIEW_THRESHOLDS = { strong: 70, baseline: 55 } as const;

/** Renderer-paint band boundaries (mirrors LEARNER_THRESHOLDS in the v77 fork). */
export const MASTERY_BANDS = { low: 55, developing: 70, strong: 80 } as const;

export type MasteryBand = "low" | "developing" | "good" | "strong";

/** The band a demonstrated (stored) mastery sits in — the decay slowest for strong. */
export function bandFor(mastery: number): MasteryBand {
  if (mastery < MASTERY_BANDS.low) return "low";
  if (mastery < MASTERY_BANDS.developing) return "developing";
  if (mastery < MASTERY_BANDS.strong) return "good";
  return "strong";
}

/** τ (days) for a demonstrated mastery — weak memories fade fastest. */
export function tauDaysFor(mastery: number): number {
  const band = bandFor(mastery);
  if (band === "strong") return DECAY_TAU_DAYS.strong;
  if (band === "low") return DECAY_TAU_DAYS.weak;
  return DECAY_TAU_DAYS.developing;
}

/** Retention multiplier (0..1) after `days` since last evidence, for τ in days. */
export function retention(days: number, tauDays: number): number {
  if (days <= 0) return 1;
  return Math.exp(-days / Math.max(1, tauDays));
}

/** Effective mastery (0..100) after decay — rounded, never above stored. */
export function effectiveMastery(stored: number, lastAt: number, now: number): number {
  const days = (now - lastAt) / 86_400_000;
  return Math.round(stored * retention(days, tauDaysFor(stored)));
}

/** The threshold this point is reviewed against, given its demonstrated mastery. */
export function reviewThresholdFor(stored: number): number {
  return stored >= MASTERY_BANDS.strong ? REVIEW_THRESHOLDS.strong : REVIEW_THRESHOLDS.baseline;
}

/**
 * When the point crosses its review threshold: lastAt + τ·ln(stored/threshold)
 * (solving stored·e^(-t/τ) = threshold). Points already at/below their
 * threshold are due the moment their evidence is recorded.
 */
export function reviewDueAt(stored: number, lastAt: number): number {
  const threshold = reviewThresholdFor(stored);
  if (stored <= threshold) return lastAt;
  const tau = tauDaysFor(stored);
  const days = Math.log(stored / threshold) * tau;
  return lastAt + days * 86_400_000;
}

/** Whether the point is review-due at `now`. */
export function isReviewDue(stored: number, lastAt: number, now: number): boolean {
  return now >= reviewDueAt(stored, lastAt);
}
