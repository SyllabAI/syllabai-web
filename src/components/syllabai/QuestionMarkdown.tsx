"use client";

/**
 * SME corpus markdown renderer (ADR-026 practice tranche): the exam-question
 * corpus is native web content — GFM markdown, raw HTML sub/sup (Save My
 * Exams writes isotopes as HTML), $…$/$$…$$ KaTeX, and `assets/…` diagram
 * references. Stems, part prompts, MCQ options and revealed solutions all
 * render through this ONE component so the surface cannot drift per-field.
 *
 * Diagrams blob-fetch through the authenticated question-asset endpoint
 * (same licensing basis + shape as the revision-note asset pipeline — plain
 * <img src> cannot carry the bearer header).
 *
 * session-119: the typography, tables, links and SME callout boxes
 * (Exam Hint / Worked Example / Case Study / Top Tip / Spec point) are
 * ported from the syllabai-demo Markdown component so both surfaces render
 * the corpus identically.
 */

import { useEffect, useState, type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import "katex/dist/katex.min.css";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchQuestionAsset } from "@/lib/api";
import { cn } from "@/lib/utils";

export function QuestionMarkdown({ children }: { children: string }) {
  return (
    <div className="prose-sm max-w-none space-y-3 break-words leading-relaxed [&_.katex]:text-[1.05em] [&_sub]:text-[0.75em] [&_sup]:text-[0.75em]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeRaw], [rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-5 border-b pb-1 text-lg font-bold">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-3 text-sm font-semibold">{children}</h4>
          ),
          h4: ({ children }) => (
            <h5 className="mt-2 text-[13px] font-semibold text-muted-foreground">
              {children}
            </h5>
          ),
          p: ({ children }) => <p className="text-[13.5px] leading-relaxed">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5 text-[13.5px]">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5 text-[13.5px]">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ href, children: linkChildren }) => {
            const h = typeof href === "string" ? href : "";
            // upstream cross-references hop learners off-site to the source
            // site — keep the label text, drop the off-site hop (demo parity)
            if (/^https?:\/\/([^/]+\.)?savemyexams\.(com|co\.uk)(\/|$)/i.test(h)) {
              return <span>{linkChildren}</span>;
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
          img: ({ alt, src }) => {
            const filename =
              typeof src === "string" ? src.replace(/^assets\//, "") : "";
            return <QuestionDiagram alt={alt ?? ""} filename={filename} />;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs [&_td]:border-b [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:border-b [&_th]:bg-muted/50 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium">
                {children}
              </table>
            </div>
          ),
          blockquote: ({ node, children }) => {
            const variant = blockquoteVariant(node);
            if (!variant) {
              return (
                <blockquote className="rounded-r-md border-l-2 border-primary/50 bg-primary/5 px-3 py-1.5 text-[13px]">
                  {children}
                </blockquote>
              );
            }
            return (
              <blockquote
                className={cn(
                  "rounded-r-md border-l-[3px] px-3 py-2 text-[13px]",
                  variant.className,
                )}
              >
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {variant.label}
                </span>
                {children}
              </blockquote>
            );
          },
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{children}</code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// ── SME callout boxes (ported from syllabai-demo) ────────────────────────

type HastNode = {
  type?: string;
  value?: string;
  children?: HastNode[];
};

function hastText(node: HastNode | undefined | null): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(hastText).join("");
}

const CALLOUT_STYLES: { match: RegExp; label: string; className: string }[] = [
  // demo tokens: warn #b45309 (amber-700), success #047857 (emerald-700),
  // info #0369a1 (sky-700), cat #6d28d9 (violet-700) — light-mode values
  {
    match: /exam hint/i,
    label: "Exam hint",
    className: "border-l-amber-700 bg-amber-700/10 dark:border-l-amber-400 dark:bg-amber-400/10",
  },
  {
    match: /worked example/i,
    label: "Worked example",
    className: "border-l-emerald-700 bg-emerald-700/10 dark:border-l-emerald-400 dark:bg-emerald-400/10",
  },
  {
    match: /case study/i,
    label: "Case study",
    className: "border-l-violet-700 bg-violet-700/10 dark:border-l-violet-400 dark:bg-violet-400/10",
  },
  {
    match: /top tip|top tips/i,
    label: "Top tip",
    className: "border-l-sky-700 bg-sky-700/10 dark:border-l-sky-400 dark:bg-sky-400/10",
  },
];

/** Corpus spec-point anchor rendered as a quiet provenance chip. */
const SPEC_ANCHOR_RE = /^\s*Spec point\b/i;

function blockquoteVariant(node: HastNode | undefined | null) {
  const text = hastText(node?.children?.[0]);
  if (SPEC_ANCHOR_RE.test(text)) {
    return { label: "Spec point", className: "border-l-primary/40 bg-muted/60" };
  }
  for (const v of CALLOUT_STYLES) {
    if (v.match.test(text)) return v;
  }
  return null;
}

/** Authenticated question diagram (blob-fetched, object-URL cached). */
export function QuestionDiagram({
  alt,
  filename,
  className,
}: {
  alt: string;
  filename: string;
  className?: ComponentPropsWithoutRef<"img">["className"];
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(() => !filename);

  useEffect(() => {
    if (!filename) return;
    let active = true;
    fetchQuestionAsset(filename)
      .then((objectUrl) => {
        if (active) setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [filename]);

  if (failed) {
    return (
      <span className="my-2 block rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Diagram unavailable ({alt || filename})
      </span>
    );
  }
  if (!url) {
    return <Skeleton className="my-2 h-32 w-full max-w-sm" />;
  }
  return <img src={url} alt={alt} className={className ?? "my-2 max-w-full rounded border"} />;
}
