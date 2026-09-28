"use client";

/**
 * Note-page client island: (1) fires the SIMULATED read event so the
 * sidebar rings react like SME's (research §8), and (2) renders the
 * "Was this revision note helpful?" micro-feedback footer (research §5.4).
 */
import { useEffect } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNoteRead, rateNoteHelpful, useCourseProgress, type Course } from "@/lib/progress";

export function NoteFootnote({
  course,
  noteId,
  subtopic,
}: {
  course: Course;
  noteId: string;
  subtopic: string | null;
}) {
  const progress = useCourseProgress(course);
  // derived from the overlay store — no local mirror state needed
  const voted = progress.notesRead[noteId]?.helpful ?? null;

  useEffect(() => {
    markNoteRead(course, noteId, subtopic);
  }, [course, noteId, subtopic]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium">Was this revision note helpful?</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={voted === "up" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => rateNoteHelpful(course, noteId, "up")}
          aria-pressed={voted === "up"}
        >
          <ThumbsUp className="size-3.5" aria-hidden /> Yes
        </Button>
        <Button
          size="sm"
          variant={voted === "down" ? "default" : "outline"}
          className="gap-1.5"
          onClick={() => rateNoteHelpful(course, noteId, "down")}
          aria-pressed={voted === "down"}
        >
          <ThumbsDown className="size-3.5" aria-hidden /> No
        </Button>
      </div>
      {voted && <p className="text-xs text-muted-foreground">Thanks — recorded to your local overlay.</p>}
    </div>
  );
}
