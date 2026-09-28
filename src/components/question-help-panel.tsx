"use client";

/**
 * Question↔note help panel — the revision notes joined to an exam question
 * through its specification-point codes (the demo twin of web's
 * QuestionHelpPanel, ADR-026 session-112).
 *
 * Client-side join by design: the join keys (specPointCodes) already ride
 * both read models — the question's parts and the note digest fetched once
 * on first open (/api/notes/[course]) — so no per-question round trip; note
 * bodies download lazily on expand (/api/notes/[course]/[noteId]) and render
 * through the standard Markdown pipeline. Honest empty states: an unmapped
 * question says so, a question whose spec points no note covers says so,
 * and a failed body fetch leaves the row collapsed (no fake content).
 */
import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

interface NoteDigestRow {
  noteId: string;
  title: string;
  specPointCodes: string[];
  path: string | null;
}

interface Match {
  note: NoteDigestRow;
  matchedCodes: string[];
}

export function QuestionHelpPanel({
  course,
  questionId,
  specPointCodes,
  tutorHref,
  /** the player's "Question help" button mounts this panel — it starts
   *  expanded so the affordance is one click, not a double toggle */
  defaultOpen = true,
}: {
  course: string;
  questionId: string;
  /** the question's spec-point codes, verbatim from its parts */
  specPointCodes: string[];
  /** the free-tutor escape hatch (preserves the old deep-link affordance) */
  tutorHref: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [digest, setDigest] = useState<NoteDigestRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);

  const codes = [...new Set(specPointCodes)];

  useEffect(() => {
    if (!open || digest || failed) return;
    let cancelled = false;
    fetch(`/api/notes/${course}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setDigest(d.notes ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, digest, failed, course]);

  const matches: Match[] =
    digest && codes.length > 0
      ? digest
          .map((n) => ({ note: n, matchedCodes: n.specPointCodes.filter((c) => codes.includes(c)) }))
          .filter((m) => m.matchedCodes.length > 0)
          .sort((a, b) => b.matchedCodes.length - a.matchedCodes.length)
          .slice(0, 6)
      : [];

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-question-id={questionId}
      className="rounded-lg border bg-muted/30"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={open}
        >
          <BookOpen className="size-4 shrink-0" aria-hidden />
          {codes.length > 0
            ? `Help with this question — related revision notes (${codes.length} spec point${codes.length === 1 ? "" : "s"})`
            : "Help with this question"}
          <ChevronDown
            className={cn("ml-auto size-4 shrink-0 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
          Looking things up is allowed — keep your confidence rating honest. Notes are joined
          through the question&apos;s specification points
          {codes.length > 0 ? ` (${codes.slice(0, 4).join(", ")}${codes.length > 4 ? ", …" : ""})` : ""}.
        </p>
        {failed ? (
          <p className="text-xs text-muted-foreground">Revision notes aren&apos;t available right now.</p>
        ) : !digest ? (
          <Skeleton className="h-12 w-full" />
        ) : matches.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {codes.length === 0
              ? "This question isn't mapped to specification points yet — no notes to join."
              : "No revision notes cover this question's specification points yet."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {matches.map(({ note, matchedCodes }) => (
              <li key={note.noteId}>
                <NoteDisclosure
                  course={course}
                  noteId={note.noteId}
                  title={note.title}
                  path={note.path}
                  matchedCodes={matchedCodes}
                  open={openNote === note.noteId}
                  onToggle={() => setOpenNote(openNote === note.noteId ? null : note.noteId)}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          Still stuck?{" "}
          <a href={tutorHref} className="inline-flex items-center gap-0.5 underline hover:text-foreground">
            Ask the free Tutor <ExternalLink className="size-3" aria-hidden />
          </a>{" "}
          — it searches the whole bundled corpus, not just these notes.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function NoteDisclosure({
  course,
  noteId,
  title,
  path,
  matchedCodes,
  open,
  onToggle,
}: {
  course: string;
  noteId: string;
  title: string;
  path: string | null;
  matchedCodes: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || body || failed) return;
    let cancelled = false;
    fetch(`/api/notes/${course}/${noteId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!cancelled) setBody(d.bodyMd ?? "");
      })
      .catch(() => {
        // the row stays collapsed on failure — honest, no fake content
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, body, failed, course, noteId]);

  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{title}</span>
          {path && <span className="block truncate text-[11px] text-muted-foreground">{path}</span>}
        </span>
        <span className="flex shrink-0 gap-1">
          {matchedCodes.slice(0, 3).map((c) => (
            <Badge key={c} variant="secondary" className="font-mono text-[10px]">
              {c}
            </Badge>
          ))}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t px-3 py-2 text-sm">
          {failed ? (
            <p className="text-xs text-muted-foreground">
              The note body couldn&apos;t be loaded.
              <Loader2 className="ml-1 inline size-3" aria-hidden />
            </p>
          ) : body === null ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <Markdown className="[&_p]:text-sm">{body}</Markdown>
          )}
          <a
            href={`/courses/${course}/revision-notes/${noteId}`}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            Open the full note <ExternalLink className="size-3" aria-hidden />
          </a>
        </div>
      )}
    </div>
  );
}
