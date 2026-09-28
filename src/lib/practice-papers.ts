/**
 * Practice Papers — the demo's honest stand-in for SME "Past Papers".
 *
 * Task 22 research finding: the committed corpus stores exam questions
 * per-topic ONLY — zero paper/year/session metadata exists in any of the 39
 * bundles (verified against questions.json fields + manifest.json). Official
 * Edexcel papers are copyrighted PDFs we cannot host. So instead of
 * fabricating provenance, we assemble full-length mixed papers
 * deterministically from the course's real topic question banks and say
 * exactly that on every surface.
 *
 * Determinism contract: for a given course slug, the same paper id always
 * yields the same question sequence (seeded PRNG) — so the paper a student
 * revises today is the paper they resume tomorrow, without persisting
 * anything. Paper 2 prefers questions Paper 1 did not use; if the bank is
 * too small it falls back to reuse rather than coming up short.
 */
import type { ExamQuestion } from "@/lib/contracts";

export interface TopicBank {
  name: string;
  slug: string;
  questions: ExamQuestion[];
}

export interface PaperItem {
  question: ExamQuestion;
  /** topic bank the question was drawn from (shown for transparency) */
  from: string;
}

export interface PracticePaper {
  id: string;
  title: string;
  /** mark target the assembly aimed for (actual total may round past it) */
  targetMarks: number;
  totalMarks: number;
  items: PaperItem[];
  coveredTopics: number;
  totalTopics: number;
}

export const PAPER_IDS = ["practice-paper-1", "practice-paper-2"] as const;
export type PaperId = (typeof PAPER_IDS)[number];

const PAPER_TARGETS: Record<PaperId, number> = {
  "practice-paper-1": 60,
  "practice-paper-2": 80,
};

/** FNV-1a — stable string hash for the PRNG seed. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG, good enough for stable sampling. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function questionMarks(q: ExamQuestion): number {
  return typeof q.totalMarks === "number" && q.totalMarks > 0 ? q.totalMarks : 1;
}

export function isPaperId(value: string): value is PaperId {
  return (PAPER_IDS as readonly string[]).includes(value);
}

/** Human meta line, mirroring the topic-page estimate convention. */
export function paperEstTime(totalMarks: number): string {
  if (totalMarks >= 80) {
    const hours = Math.round(totalMarks / 60);
    return `≈ ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `≈ ${totalMarks} min`;
}

/**
 * Assemble one practice paper. Round-robins the topic banks (deterministic
 * start offset per paper so Paper 1 and Paper 2 lead with different topics),
 * sampling an unseen question from each bank until the mark target is met
 * or every pool is exhausted.
 */
function assemble(
  slug: string,
  id: PaperId,
  banks: TopicBank[],
  avoidIds: Set<string>,
): PracticePaper {
  const usable = banks.filter((b) => b.questions.length > 0);
  const rand = mulberry32(fnv1a(`${slug}:${id}`));
  const target = PAPER_TARGETS[id];

  // per-bank shuffled pools (deterministic order) + rotating cursors
  const pools = usable.map((b) => {
    const qs = [...b.questions];
    for (let i = qs.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [qs[i], qs[j]] = [qs[j], qs[i]];
    }
    return { bank: b, qs, cursor: 0 };
  });

  const items: PaperItem[] = [];
  const usedIds = new Set<string>();
  const fallback: Array<{ pool: (typeof pools)[number]; item: PaperItem }> = [];

  let total = 0;
  let round = 0;
  while (total < target && round < pools.length) {
    for (const pool of pools) {
      if (total >= target) break;
      // advance to the next question this paper hasn't used yet
      while (pool.cursor < pool.qs.length && usedIds.has(pool.qs[pool.cursor].id)) pool.cursor++;
      if (pool.cursor >= pool.qs.length) continue;
      const q = pool.qs[pool.cursor];
      const item: PaperItem = { question: q, from: pool.bank.name };
      if (usedIds.has(q.id)) continue;
      if (avoidIds.has(q.id) && round === 0) {
        // Paper 2: hold unseen-question candidates for a second pass
        fallback.push({ pool, item });
        pool.cursor++;
        continue;
      }
      items.push(item);
      usedIds.add(q.id);
      total += questionMarks(q);
      pool.cursor++;
    }
    round++;
  }
  // bank too small for full avoidance → top up from held-back candidates
  for (const held of fallback) {
    if (total >= target) break;
    if (usedIds.has(held.item.question.id)) continue;
    items.push(held.item);
    usedIds.add(held.item.question.id);
    total += questionMarks(held.item.question);
  }

  return {
    id,
    title: `Practice Paper ${id.endsWith("1") ? "1" : "2"}`,
    targetMarks: target,
    totalMarks: total,
    items,
    coveredTopics: new Set(items.map((i) => i.from)).size,
    totalTopics: usable.length,
  };
}

/** Build both papers for a course (Paper 2 avoids Paper 1's questions). */
export function buildPracticePapers(slug: string, banks: TopicBank[]): PracticePaper[] {
  const paper1 = assemble(slug, "practice-paper-1", banks, new Set());
  const avoid = new Set(paper1.items.map((i) => i.question.id));
  const paper2 = assemble(slug, "practice-paper-2", banks, avoid);
  return [paper1, paper2];
}

export function getPaper(papers: PracticePaper[], id: string): PracticePaper | null {
  return papers.find((p) => p.id === id) ?? null;
}
