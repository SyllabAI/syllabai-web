"use client";

/**
 * Revision Notes index — SME pattern (research §5.1, figure 3): numbered
 * topic headings with sub-topic accordions and note links underneath.
 * Grouping comes from the canonical spec tree, never a second taxonomy.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronGlyph, NumberedLabel } from "@/components/hub/chrome";
import { ProgressRing } from "@/components/hub/progress-ring";
import { useCourseProgress, type Course } from "@/lib/progress";
import { cn } from "@/lib/utils";
import type { SpecTree } from "@/lib/spec-tree";

export interface NoteListItem {
  noteId: string;
  title: string;
  guidedStudy: boolean;
  specPointCodes: string[];
  subtopic: string | null;
}

const ZERO = { notes: 0, questions: 0, flashcards: 0 };

export function NotesIndex({
  course,
  tree,
  counts,
  notes,
  initialSubtopic,
}: {
  course: Course;
  tree: SpecTree;
  counts: Record<string, { notes: number; questions: number; flashcards: number }>;
  notes: NoteListItem[];
  initialSubtopic: string | null;
}) {
  const progress = useCourseProgress(course);

  const groups = useMemo(() => {
    return tree.topics
      .map((t) => ({
        topic: t,
        subtopics: t.subtopics
          .map((s) => ({
            subtopic: s,
            notes: notes.filter((n) => n.subtopic === s.code),
          }))
          .filter((g) => g.notes.length > 0),
      }))
      .filter((g) => g.subtopics.length > 0);
  }, [tree, notes]);

  const unmapped = notes.filter((n) => !n.subtopic);

  const defaultOpen = useMemo(() => {
    if (initialSubtopic) {
      const t = tree.topics.find((t) => t.subtopics.some((s) => s.code === initialSubtopic));
      if (t) return new Set([t.code]);
    }
    const first = groups[0];
    return new Set(first ? [first.topic.code] : []);
  }, [tree.topics, initialSubtopic, groups]);

  const [open, setOpen] = useState<Set<string>>(defaultOpen);
  const [lastDefault, setLastDefault] = useState(defaultOpen);
  if (lastDefault !== defaultOpen) {
    // render-phase adjustment (React-endorsed derived-state reset)
    setLastDefault(defaultOpen);
    setOpen(defaultOpen);
  }

  const toggle = (code: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="space-y-5">
      {groups.map(({ topic, subtopics }) => {
        const isOpen = open.has(topic.code);
        return (
          <section key={topic.code} aria-label={`Topic ${topic.number}: ${topic.title}`}>
            <button
              type="button"
              onClick={() => toggle(topic.code)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40"
            >
              <ProgressRing
                course={course}
                subtopic={subtopics[0]?.subtopic.code ?? null}
                counts={counts[subtopics[0]?.subtopic.code ?? ""] ?? ZERO}
                size={20}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-snug">
                  <NumberedLabel number={topic.number} title={topic.title} />
                </span>
                <span className="block text-xs text-muted-foreground">
                  {topic.subtopics.length} Topics ·{" "}
                  {topic.subtopics.reduce((a, s) => a + (counts[s.code]?.notes ?? 0), 0)} Revision
                  Notes
                </span>
              </span>
              <ChevronGlyph open={isOpen} />
            </button>

            {isOpen && (
              <div className="ml-4 mt-2 space-y-2 border-l pl-3">
                {subtopics.map(({ subtopic, notes: subNotes }) => (
                  <div key={subtopic.code} className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProgressRing course={course} subtopic={subtopic.code} counts={counts[subtopic.code] ?? ZERO} size={16} />
                      <h2 className="text-sm font-medium">{subtopic.title}</h2>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {subNotes.map((n) => {
                        const read = !!progress.notesRead[n.noteId];
                        return (
                          <Link
                            key={n.noteId}
                            href={`/courses/${course}/revision-notes/${n.noteId}`}
                            className={cn(
                              "group flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-[13px] transition-colors hover:border-primary/40",
                              initialSubtopic === n.subtopic && "border-primary/30 bg-primary/[0.04]",
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "mt-1.5 size-1.5 shrink-0 rounded-full",
                                read ? "bg-primary" : "bg-muted-foreground/30",
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium leading-snug group-hover:text-primary">
                                {n.title}
                              </span>
                              <span className="mt-1 flex flex-wrap items-center gap-1">
                                {n.specPointCodes.slice(0, 3).map((c) => (
                                  <code key={c} className="rounded bg-muted px-1 text-[10px]">
                                    {c}
                                  </code>
                                ))}
                                {n.guidedStudy && (
                                  <Badge variant="secondary" className="text-[10.5px]">
                                    guided study
                                  </Badge>
                                )}
                              </span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}

      {unmapped.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-medium">Not yet anchored to a spec point</p>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              These notes exist in the corpus without a machine-readable specification anchor —
              the spec-point mapping (still in progress upstream) will slot them into the tree.
            </p>
            <ul className="space-y-1.5">
              {unmapped.map((n) => (
                <li key={n.noteId}>
                  <Link
                    href={`/courses/${course}/revision-notes/${n.noteId}`}
                    className="text-[13px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {groups.length === 0 && unmapped.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No revision notes imported for this course yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
