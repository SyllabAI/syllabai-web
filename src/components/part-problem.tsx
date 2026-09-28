"use client";

/**
 * PartProblem — renders a question part's problem markdown with SME mark
 * placement (research figures 15/16, verified 2026-09-19).
 *
 * The corpus stores each sub-part's mark allocation as a bare trailing tag on
 * its own line — "[2]", "(1)", "[3 marks]" — left over from the upstream
 * exam-paper layout. SME renders those right-aligned at the part's right edge
 * ("(1 mark)" under the last line of the part; "2 marks" right-aligned in the
 * mark-scheme part header). Rendering them through <Markdown> leaves them as
 * orphaned left-aligned lines, which reads as broken layout.
 *
 * Split rules (conservative):
 *   - a line must consist ONLY of an optional **-bold wrapper around
 *     [N] / (N) / [N marks] / (N marks) to qualify — never a table row or
 *     text with a trailing tag;
 *   - lines inside ``` / ~~~ fences are never touched.
 * Markdown segments render through the standard <Markdown> pipeline (math,
 * emphasis, images all intact); mark segments render as a right-aligned
 * "(N mark[s])" line, exactly SME's placement.
 */
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

export type MdSegment = { kind: "md"; text: string } | { kind: "marks"; count: number };

const MARK_LINE_RE = /^\s*(?:\*\*)?\s*[\[\(]\s*(\d+)\s*(?:marks?|)\s*[\]\)]\s*(?:\*\*)?\s*$/i;
const FENCE_RE = /^\s*(?:```|~~~)/;

export function splitMarkLines(md: string): MdSegment[] {
  const segments: MdSegment[] = [];
  let buf: string[] = [];
  let fence = false;
  const flush = () => {
    if (buf.some((l) => l.trim().length > 0)) segments.push({ kind: "md", text: buf.join("\n") });
    buf = [];
  };
  for (const line of md.split("\n")) {
    if (FENCE_RE.test(line)) fence = !fence;
    const m = fence ? null : line.match(MARK_LINE_RE);
    if (m) {
      flush();
      segments.push({ kind: "marks", count: Number(m[1]) });
    } else {
      buf.push(line);
    }
  }
  flush();
  return segments;
}

export function PartProblem({ md, className }: { md: string; className?: string }) {
  const segments = splitMarkLines(md);
  return (
    <div className={cn(className)}>
      {segments.map((s, i) =>
        s.kind === "md" ? (
          <Markdown key={i}>{s.text}</Markdown>
        ) : (
          <p
            key={i}
            className="text-right text-xs tabular-nums text-muted-foreground"
            aria-label={`${s.count} mark${s.count === 1 ? "" : "s"}`}
          >
            ({s.count} mark{s.count === 1 ? "" : "s"})
          </p>
        ),
      )}
    </div>
  );
}
