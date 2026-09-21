"use client";

/**
 * Question help (ADR-026 practice tranche, session-112 shared): the revision
 * notes joined to a question through its specification-point codes — the
 * question↔note cross-link the exam-questions browser and practice both
 * render. Client-side join by design: the join keys (specPointCodes) already
 * ride both read models, so no extra round trip; notes load lazily on first
 * open and bodies on expand.
 */

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import type { RevisionNoteBodyView, RevisionNotesIndexView, StudentQuestionView } from "@/lib/types";
import { QuestionMarkdown } from "./QuestionMarkdown";

export function QuestionHelpPanel({ question }: { question: StudentQuestionView }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<RevisionNotesIndexView | null>(null);
  const [failed, setFailed] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);

  const codes = question.specPointCodes ?? [];

  useEffect(() => {
    if (!open || index || failed) return;
    let cancelled = false;
    api
      .revisionNotes()
      .then((idx) => {
        if (!cancelled) setIndex(idx);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, index, failed]);

  const matches =
    index && codes.length > 0
      ? index.topics
          .flatMap((t) =>
            t.subtopics.flatMap((s) =>
              s.notes
                .filter((n) => n.specPointCodes.some((c) => codes.includes(c)))
                .map((n) => ({ note: n, topic: t.title, subtopic: s.title })),
            ),
          )
          .slice(0, 6)
      : [];

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-muted/20">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="size-4" aria-hidden="true" />
          {codes.length > 0
            ? `Help with this question — related revision notes (${codes.length} spec point${codes.length === 1 ? "" : "s"})`
            : "Help with this question"}
          <ChevronDown
            className={`ml-auto size-4 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <p className="mb-2 text-[11px] text-muted-foreground">
          Looking things up is allowed — keep your confidence rating honest. Notes are
          joined through the question&apos;s specification points
          {codes.length > 0 ? ` (${codes.join(", ")})` : ""}.
        </p>
        {failed ? (
          <p className="text-xs text-muted-foreground">
            Revision notes aren&apos;t available right now.
          </p>
        ) : !index ? (
          <Skeleton className="h-12 w-full" />
        ) : matches.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {codes.length === 0
              ? "This question isn't mapped to specification points yet — no notes to join."
              : "No revision notes cover this question's specification points yet."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {matches.map(({ note, topic, subtopic }) => (
              <li key={note.noteId}>
                <NoteDisclosure
                  noteId={note.noteId}
                  title={note.title}
                  path={`${topic} · ${subtopic}`}
                  matchedCodes={note.specPointCodes.filter((c) => codes.includes(c))}
                  open={openNote === note.noteId}
                  onToggle={() => setOpenNote(openNote === note.noteId ? null : note.noteId)}
                />
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function NoteDisclosure({
  noteId,
  title,
  path,
  matchedCodes,
  open,
  onToggle,
}: {
  noteId: string;
  title: string;
  path: string;
  matchedCodes: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const [body, setBody] = useState<RevisionNoteBodyView | null>(null);

  useEffect(() => {
    if (!open || body) return;
    let cancelled = false;
    api
      .revisionNote(noteId)
      .then((b) => {
        if (!cancelled) setBody(b);
      })
      .catch(() => {
        /* the row stays collapsed on failure — honest, no fake content */
      });
    return () => {
      cancelled = true;
    };
  }, [open, noteId, body]);

  return (
    <div className="rounded-md border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{path}</span>
        </span>
        <span className="flex shrink-0 gap-1">
          {matchedCodes.slice(0, 3).map((c) => (
            <Badge key={c} variant="secondary" className="font-mono text-[10px]">
              {c}
            </Badge>
          ))}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t px-3 py-2">
          {body ? <QuestionMarkdown>{body.bodyMd}</QuestionMarkdown> : <Skeleton className="h-24 w-full" />}
        </div>
      )}
    </div>
  );
}
