/**
 * Note body sanitizer — repairs the two systematic SME import artifacts
 * found by the Task 19 audit (work/audit19):
 *
 * 1. Spec-point anchor chips. The importer emitted `> **Spec point** —
 *    \`spcpt_*\`` lines in two shapes:
 *      - "id · readable spec text" → the id is stripped and the text kept
 *        (learner face shows "Spec point — Understand the three states…").
 *      - "id at line end" (3,549 lines in 2,213 notes, every course) → the
 *        whole chip is removed: with no readable text the chip would only
 *        expose the raw upstream id, which Task 16 banished from learner
 *        faces (anchor codes stay in the data layer).
 *
 * 2. Duplicated headings. Around every anchor chip the importer re-emitted
 *    the section heading: `## H ⏎ chip ⏎ ## H ⏎ content`. Collapsing the
 *    later duplicate when a heading is followed only by blank lines and
 *    anchor chips restores the intended "heading → chip → content" order
 *    (2,380 render-visible duplicate pairs fixed corpus-wide).
 *
 * Everything here is order-preserving, fence-aware, and idempotent — run it
 * once per render in the note reader. Rendering-level fixes (callout chips,
 * math repair) stay in components/markdown.tsx; this module only edits the
 * raw markdown the way the importer should have.
 */

const HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const CHIP_LINE_RE = /^\s*>\s*\*\*Spec point\*\*/;
/** "id · text" — strip the id, keep the readable spec text. */
const CHIP_ID_MIDDLE_RE = /(`)?spcpt_[A-Za-z0-9_-]+(`)?(\s*·\s*)/g;
/** "id at line end" — no readable text follows, the chip carries nothing
 *  a learner needs, so the entire line goes. */
const CHIP_ID_ONLY_RE = /^[ \t]*>[ \t]*\*\*Spec point\*\*[ \t]*[—–-][ \t]*(`)?spcpt_[A-Za-z0-9_-]+(`)?[ \t]*$/gm;

function stripLeadingTitleDuplicates(bodyMd: string, title: string): string {
  const t = title.trim().toLowerCase();
  let out = bodyMd.replace(/^\s*#\s+([^\n]+)\n?/, (m, h: string) =>
    h.trim().toLowerCase() === t ? "" : m,
  );
  out = out.replace(/^\s*##\s+([^\n]+)\n+/, (m, h: string) =>
    h.trim().toLowerCase() === t ? "" : m,
  );
  return out;
}

/**
 * Drop the later of two identical adjacent headings when nothing but blank
 * lines and spec-point anchor chips separates them ("## H ⏎ chip ⏎ ## H" →
 * "## H ⏎ chip"). Chained duplicates collapse in the same pass because the
 * first heading stays pending until real content appears. Fence-aware:
 * lines inside a ``` / ~~~ block are content, never headings or chips.
 */
export function collapseDuplicateHeadings(bodyMd: string): string {
  const lines = bodyMd.split("\n");
  const out: string[] = [];
  let pendingIdx = -1; // out[] position of the last heading with no content yet
  let pendingText = "";
  let inFence = false;

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      // a fenced block is content — whatever heading precedes it is "used"
      pendingIdx = -1;
      pendingText = "";
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence) {
      const m = line.match(HEADING_RE);
      if (m) {
        const text = m[2].trim().toLowerCase();
        if (pendingIdx >= 0 && text === pendingText) continue; // later duplicate → drop
        pendingIdx = out.length;
        pendingText = text;
        out.push(line);
        continue;
      }
      if (line.trim() !== "" && !CHIP_LINE_RE.test(line)) {
        pendingIdx = -1; // real content lives under the pending heading
        pendingText = "";
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Full reader-face repair: title dedup + anchor chips + heading collapse. */
export function sanitizeNoteBody(bodyMd: string, title: string): string {
  let md = stripLeadingTitleDuplicates(bodyMd, title);
  md = md.replace(CHIP_ID_ONLY_RE, "");
  md = md.replace(CHIP_ID_MIDDLE_RE, " ");
  return collapseDuplicateHeadings(md);
}
