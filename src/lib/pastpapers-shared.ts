/**
 * Past Papers shared helpers — CLIENT-SAFE (no corpus index import).
 *
 * The full corpus index (src/data/pastpapers-index.json, ~285 KB) must stay
 * server-side: it feeds server components only. Anything a client component
 * needs — types, raw URL construction, labels — lives here so the index is
 * never bundled for the browser.
 */

// ── index shapes ───────────────────────────────────────────────────────────
export interface CorpusPaper {
  /** paper dir name, e.g. "4CH1-1C", "WMA11-01A" */
  d: string;
  /** material byte sizes (load hints) */
  qp?: number;
  ms?: number;
  er?: number;
  /** non-canonical pdf extras: [filename, bytes] */
  x?: Array<[string, number]>;
}

export interface CorpusSession {
  id: string;
  papers: CorpusPaper[];
}

export interface CorpusSpec {
  board: string;
  qual: string;
  subject: string;
  spec: string;
  sessions: CorpusSession[];
}

export interface CorpusIndexMeta {
  generatedAt: string;
  source: string;
  treeSha: string;
  note: string;
}

/** Flattened paper entry (what pages/components consume). */
export interface CorpusPaperEntry {
  /** index key, e.g. "pearson-edexcel/international-gcse/chemistry/4ch1" */
  specKey: string;
  specTitle: string;
  qual: string;
  sessionId: string;
  dir: string;
  /** official unit code, e.g. "4CH1" / "WCH11" */
  unit: string;
  /** paper variant part, e.g. "1C" / "01A" */
  variant: string;
  /** official reference "4CH1/1C" */
  ref: string;
  /** human title, e.g. "Paper 1C" / "Unit 1" */
  title: string;
  /** "Legacy spec" chip for retired-spec papers surfaced in the same archive */
  specBadge: string | null;
  /** "Timezone R" / "Variant A" chip, when applicable */
  variantChip: string | null;
  qpBytes?: number;
  msBytes?: number;
  erBytes?: number;
  /** attested official duration in minutes, or null (editable estimate) */
  durationMin: number | null;
  qpPath: string;
  msPath: string;
}

// ── pure helpers ───────────────────────────────────────────────────────────
export const PASTPAPERS_REPO = "SyllabAI/syllabai-pastpapers";

/** Public raw URL for any corpus-relative path. */
export function corpusRawUrl(corpusPath: string): string {
  return `https://raw.githubusercontent.com/${PASTPAPERS_REPO}/main/${corpusPath}`;
}

export function corpusRawPath(specKey: string, sessionId: string, dir: string, file: string): string {
  // specKeys omit the corpus repo's "past-papers/" root — raw paths need it
  const infix = sessionId === "specimen" ? "specimen" : `past-papers/${sessionId}`;
  return `past-papers/${specKey}/${infix}/${dir}/${file}`;
}

/** "2021-06" → "June 2021"; "specimen" → "Specimen". */
export function sessionLabel(id: string): string {
  if (id === "specimen") return "Specimen";
  const m = id.match(/^(\d{4})-(\d{2})$/);
  if (!m) return id;
  const months = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[Number(m[2])] ?? m[2]} ${m[1]}`;
}

export function sessionRankOf(id: string): number {
  if (id === "specimen") return -1;
  const m = id.match(/^(\d{4})-(\d{2})$/);
  return m ? Number(m[1]) * 12 + Number(m[2]) : -2;
}

/** IAL unit display names (WMA11 → "Pure 1", WCH11 → "Unit 1", …). */
export const IAL_UNIT_TITLES: Record<string, string> = {
  WMA11: "Pure 1", WMA12: "Pure 2", WMA13: "Pure 3", WMA14: "Pure 4",
  WME01: "Mechanics 1", WME02: "Mechanics 2", WME03: "Mechanics 3",
  WST01: "Statistics 1", WST02: "Statistics 2", WST03: "Statistics 3",
  WDM11: "Decision 1",
  WFM01: "Further Pure 1", WFM02: "Further Pure 2", WFM03: "Further Pure 3",
};

export function ialUnitTitle(unit: string): string {
  return IAL_UNIT_TITLES[unit] ?? `Unit ${unit.slice(-1)}`;
}

export function specTitle(spec: CorpusSpec): string {
  const qual =
    spec.qual === "international-gcse"
      ? "IGCSE"
      : spec.qual === "international-a-level"
        ? "IAL"
        : spec.qual;
  return `${qual} ${spec.subject} ${spec.spec.toUpperCase()}`;
}

/** Group papers by session for the SME-style year sections (input sorted). */
export function groupBySession(papers: CorpusPaperEntry[]): Array<[string, CorpusPaperEntry[]]> {
  const bySession = new Map<string, CorpusPaperEntry[]>();
  for (const p of papers) {
    bySession.set(p.sessionId, [...(bySession.get(p.sessionId) ?? []), p]);
  }
  return [...bySession.entries()];
}

/** "0.7 MB" load hint from bytes. */
export function prettyBytes(n: number | undefined): string {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
