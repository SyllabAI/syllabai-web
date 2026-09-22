"use client";

/**
 * PartProblem — SME mark placement, ported from syllabai-demo
 * (src/components/part-problem.tsx, research figures 15/16, verified
 * 2026-09-19) so the exam-questions surface renders part prompts with the
 * demo's exact look.
 *
 * The SME corpus stores each sub-part's mark allocation as a bare trailing
 * tag on its own line — "[2]", "(1)", "[3 marks]" — left over from the
 * upstream exam-paper layout. SME renders those right-aligned at the part's
 * right edge ("(1 mark)" under the last line of the part; "2 marks"
 * right-aligned in the mark-scheme part header). Rendering them through
 * QuestionMarkdown would leave them as orphaned left-aligned lines, which
 * reads as broken layout.
 *
 * Split rules (conservative, demo-identical):
 *   - a line must consist ONLY of an optional **-bold wrapper around
 *     [N] / (N) / [N marks] / (N marks) to qualify — never a table row or
 *     text with a trailing tag;
 *   - lines inside ``` / ~~~ fences are never touched.
 * Markdown segments render through the standard QuestionMarkdown pipeline
 * (math, emphasis, authenticated images all intact); mark segments render as
 * a right-aligned "(N mark[s])" line, exactly SME's placement.
 */
import { QuestionMarkdown } from "./QuestionMarkdown";
import { cn } from "@/lib/utils";

export type MdSegment = { kind: "md"; text: string } | { kind: "marks"; count: number };

const MARK_LINE_RE = /^\s*(?:\*\*)?\s*[\[\(]\s*(\d+)\s*(?:marks?|)\s*[\]\)]\s*(?:\*\*)?\s*$/i;
const FENCE_RE = /^\s*(```|~~~)/;

export function splitMarkLines(md: string): MdSegment[] {
  const segments: MdSegment[] = [];
  let buf: string[] = [];
  let fence = false;
  const flush = () => {
    if (buf.some((l) => l.trim().length > 0)) segments.push({ kind: "md", text: buf.join("\n") });
    buf = [];
  };
  for (const line of md.split("\n")) {
    if (FENCE_RE.test(line)) {
      // fences stay inside the markdown stream untouched
      buf.push(line);
      fence = !fence;
      continue;
    }
    if (!fence) {
      const m = line.match(MARK_LINE_RE);
      if (m) {
        flush();
        segments.push({ kind: "marks", count: Number(m[1]) });
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return segments;
}

export function PartProblem({ md, className }: { md: string; className?: string }) {
  const segments = splitMarkLines(md);
  if (segments.length === 0) return null;
  return (
    <div className={cn("space-y-1.5", className)}>
      {segments.map((seg, i) =>
        seg.kind === "md" ? (
          <QuestionMarkdown key={i}>{seg.text}</QuestionMarkdown>
        ) : (
          <p key={i} className="text-right text-xs text-muted-foreground" aria-label={`${seg.count} mark${seg.count === 1 ? "" : "s"}`}>
            ({seg.count} mark{seg.count === 1 ? "" : "s"})
          </p>
        ),
      )}
    </div>
  );
}
