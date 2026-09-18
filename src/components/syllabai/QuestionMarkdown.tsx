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

export function QuestionMarkdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded [&_img]:border [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_.katex]:text-[1.05em] [&_sub]:text-[0.75em] [&_sup]:text-[0.75em]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          img: ({ alt, src }) => {
            const filename =
              typeof src === "string" ? src.replace(/^assets\//, "") : "";
            return <QuestionDiagram alt={alt ?? ""} filename={filename} />;
          },
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1">
                {children}
              </table>
            </div>
          ),
          a: ({ href, children: linkChildren }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
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
