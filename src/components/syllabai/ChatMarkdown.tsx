"use client";

/**
 * Shared renderer for MODEL-GENERATED chat answers (Tutor + every CLA
 * surface, s138). The corpus renderer (QuestionMarkdown) always had the full
 * pipeline; the chat surfaces rendered answers as plain `whitespace-pre-wrap`
 * text, so the model's markdown (**bold**, bullets, tables) and LaTeX showed
 * raw.
 *
 * Pipeline: GFM + remark-math + rehype-katex (mhchem registered — \ce{}
 * chemistry renders) + remark-breaks (single newlines are line breaks in
 * chat, not paragraph merges). Deliberately NO rehype-raw: model output is
 * not corpus content, raw HTML stays escaped (prompt v3 forbids HTML tags;
 * LaTeX is the sub/superscript path).
 *
 * Citation markers ([n] and fullwidth 【n】) are rewritten by a local remark
 * plugin into `citation://n` links — they survive inside every markdown
 * construct (bold, lists, tables) instead of the old pre-markdown string
 * split, and each surface keeps its own chip via `renderCitation`.
 *
 * GLM-side delimiter drift is normalized defensively (the prompt pins
 * $…$/$$…$$, old transcripts and cold models still drift):
 * - \(…\)        → $…$          (unambiguous, always)
 * - \[…\]        → $$…$$        (only when the body looks like LaTeX)
 * - bare \ce{…}  → $\ce{…}$     (outside math, never double-wrapped)
 */

import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
// side-effect: registers the \ce{} macro on the shared KaTeX instance that
// rehype-katex renders through (bundled inside the existing katex package —
// no extra dependency)
import "katex/contrib/mhchem";
import { cn } from "@/lib/utils";

// ── citation markers: [n] / 【n】, 1–3 digits (a [2025] stays plain text) ──

const MARKER_RE = /[\u005B\u3010](\d{1,3})[\u005D\u3011]/g;

type MdastNode = {
  type?: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
};

/** split a text node into text + `citation://n` link nodes (null if no marker) */
function splitCitations(value: string): MdastNode[] | null {
  if (!/[\u005B\u3010]\d/.test(value)) return null;
  const out: MdastNode[] = [];
  let last = 0;
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(value)) !== null) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) });
    out.push({
      type: "link",
      url: `citation://${m[1]}`,
      children: [{ type: "text", value: m[1] }],
    });
    last = MARKER_RE.lastIndex;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}

/** walk mdast, rewriting citation markers inside text nodes in place.
 *  Code spans/blocks and math nodes hold their content in `.value`, not in
 *  `text` children — a [1] inside them is deliberately left alone.
 *  (exported for the s138 runtime verification script — no other consumer) */
export function remarkCitations() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === "text" && typeof child.value === "string") {
          const replaced = splitCitations(child.value);
          if (replaced) {
            node.children.splice(i, 1, ...replaced);
            i += replaced.length - 1;
          }
        } else {
          walk(child);
        }
      }
    };
    walk(tree);
  };
}

// module-level identities: react-markdown re-parses when plugin identity changes
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkCitations, remarkBreaks];
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, strict: false }]];

// ── delimiter normalization (see header) ─────────────────────────────────

const LATEXISH = /[\\^_{}]/; // \frac, x^2, H_2, {…} — an escaped literal never has these

export function normalizeMathDelimiters(answer: string): string {
  return answer
    // \( … \) → $ … $  (inline; \( never occurs in prose)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => `$${tex}$`)
    // \[ … \] → $$ … $$  (display; only when the body looks like LaTeX, so
    // the escaped literal \[1\] stays a literal)
    .replace(/\\\[([\s\S]+?)\\\]/g, (m, tex: string) =>
      LATEXISH.test(tex) ? `$$${tex}$$` : m,
    )
    // bare \ce{…} → $\ce{…}$  (outside math delimiters; the lookbehind/
    // lookahead keep an already-delimited $\ce{…}$ untouched)
    .replace(/(?<![$\\])\\ce\{([^}]*)\}(?!\$)/g, (_m, tex: string) => `$\\ce{${tex}}$`);
}

export function ChatMarkdown({
  children,
  renderCitation,
  className,
}: {
  /** the raw model answer (markdown + LaTeX + [n] citation markers) */
  children: string;
  /** renders the citation chip for marker n — each surface owns its look */
  renderCitation?: (marker: number) => ReactNode;
  className?: string;
}) {
  const normalized = useMemo(() => normalizeMathDelimiters(children), [children]);

  return (
    <div
      className={cn(
        "max-w-none break-words text-sm leading-relaxed space-y-2.5",
        "[&_.katex]:text-[1.05em]",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS as never}
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          h1: ({ children }) => <p className="pt-1 text-sm font-semibold">{children}</p>,
          h2: ({ children }) => <p className="pt-1 text-sm font-semibold">{children}</p>,
          h3: ({ children }) => <p className="pt-1 text-sm font-semibold">{children}</p>,
          a: ({ href, children: linkChildren }) => {
            const h = typeof href === "string" ? href : "";
            if (h.startsWith("citation://")) {
              const n = Number(h.slice("citation://".length));
              return <>{renderCitation ? renderCitation(n) : `[${n}]`}</>;
            }
            if (h.startsWith("http")) {
              return (
                <a
                  href={h}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary underline underline-offset-2"
                >
                  {linkChildren}
                </a>
              );
            }
            return (
              <a href={h} className="text-primary underline underline-offset-2">
                {linkChildren}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs [&_td]:border-b [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:border-b [&_th]:bg-muted/50 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium">
                {children}
              </table>
            </div>
          ),
          blockquote: ({ children }) => (
            <blockquote className="rounded-r-md border-l-2 border-primary/50 bg-primary/5 px-3 py-1.5 text-[13px]">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-muted p-2.5 text-xs">{children}</pre>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{children}</code>
          ),
          hr: () => <hr className="border-border" />,
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
