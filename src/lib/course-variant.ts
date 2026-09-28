/**
 * Course variant subtitles (UX audit P2-7).
 *
 * The registry contains lanes that share the same subject + exam code —
 * e.g. two Accounting 4AC1 lanes (Financial Statements vs Introduction to
 * Bookkeeping) or six Science Double Award modular units. Both render as
 * identical title+code cards, which reads as a duplicate. The
 * differentiator (the SME lane qualifier) is carried by the slug tail, so
 * we derive a human subtitle from it — but ONLY for lanes inside a
 * duplicate (subject, code) group, so ordinary cards stay unchanged.
 *
 * Client-safe: no "server-only" import (consumed by client components).
 */

export interface VariantKeyable {
  slug: string;
  subject: string;
  code: string;
}

const LEVEL_TOKENS = new Set(["igcse", "ial", "gcse", "as", "alevel"]);
const SMALL_WORDS = new Set(["to", "and", "of", "in", "the", "with", "for", "a"]);

/**
 * "igcse-accounting-17-financial-statements" + subject "Accounting"
 *   → "Financial Statements"
 * "igcse-accounting-17-introduction-to-bookkeeping-and-accounting"
 *   + subject "Accounting" → "Introduction to Bookkeeping and Accounting"
 * "igcse-maths-a-modular-24-foundation-unit-1" + subject "Maths"
 *   → "Foundation Unit 1"
 * "igcse-science-double-award-modular-24-biology-unit-1" + subject "Science"
 *   → "Double Award Modular Biology Unit 1"
 * "igcse-english-language-a-16-paper-3-coursework" + subject "English Language"
 *   → "Paper 3 Coursework"
 * "ial-maths-20-pure-1" + subject "Maths" → "Pure 1"
 *
 * Strips left-to-right: leading level prefix, leading subject words (in
 * order, so a mid-phrase repeat like "…bookkeeping-and-accounting"
 * survives), a leading qualification letter ("maths-a", "english-language-a"),
 * then a leading run of "modular"/year tokens. Any remaining 2–4-digit year
 * tokens are dropped (single digits like "Unit 1"/"Pure 1" survive).
 */
export function variantSubtitle(slug: string, subject: string): string {
  const tokens = slug.split("-").filter(Boolean);
  let i = 0;

  while (i < tokens.length && LEVEL_TOKENS.has(tokens[i])) i++;

  const subjectWords = subject.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let si = 0;
  while (i < tokens.length && si < subjectWords.length && tokens[i] === subjectWords[si]) {
    i++;
    si++;
  }

  // qualification letter right after the subject ("maths-a", "english-language-a")
  while (i < tokens.length && /^[a-z]$/.test(tokens[i])) i++;

  // leading run of modular / syllabus-year tokens ("modular-24", "17")
  while (i < tokens.length && (tokens[i] === "modular" || /^\d{2,4}$/.test(tokens[i]))) i++;

  // syllabus-year tokens anywhere else in the qualifier are registry noise
  const rest = tokens.slice(i).filter((t) => !/^\d{2,4}$/.test(t));
  if (rest.length === 0) return "";

  return rest
    .map((t, idx) =>
      idx > 0 && SMALL_WORDS.has(t) ? t : t.charAt(0).toUpperCase() + t.slice(1),
    )
    .join(" ");
}

/**
 * slug → subtitle map, covering only lanes whose (subject, code) pair
 * appears more than once in the registry.
 */
export function duplicateVariants<T extends VariantKeyable>(courses: T[]): Map<string, string> {
  const groups = new Map<string, number>();
  for (const c of courses) {
    const key = `${c.subject.toLowerCase()}|${c.code}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const c of courses) {
    const key = `${c.subject.toLowerCase()}|${c.code}`;
    if ((groups.get(key) ?? 0) > 1) {
      const sub = variantSubtitle(c.slug, c.subject);
      if (sub) out.set(c.slug, sub);
    }
  }
  return out;
}
