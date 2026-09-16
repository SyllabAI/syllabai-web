"use client";
/**
 * Revision Notes (Save-My-Exams-style learner surface, pilot corpus: Edexcel
 * IGCSE Chemistry 4CH1 — content licensed for internal pilot use only, served
 * exclusively through the authenticated learner API, never bundled client-side).
 *
 * Faithful to the investigated SME feature set:
 * - left sidebar: topic groups with aggregate counts ("8 Topics · 36 Notes") →
 *   subtopic rows carrying a 24px SVG progress ring (viewed ÷ total notes) →
 *   note links, auto-expanding around the current note;
 * - "View all topics" grid: per-topic cards with subtopic accordions and rings;
 * - reader: title, spec-point badges, markdown body with authenticated diagram
 *   images (blob-fetched), Previous/Next navigation in canonical corpus order;
 * - progress: opening a note marks it viewed (backend-backed, idempotent) —
 *   the same model as SME's localStorage counter but per-account persistent.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, fetchRevisionNoteAsset } from "@/lib/api";
import type {
  RevisionNoteBodyView,
  RevisionNotesIndexView,
} from "@/lib/types";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutGrid,
} from "lucide-react";

/** SME-style 24px donut: viewed notes ÷ total notes for one subtopic. */
function ProgressRing({ viewed, total }: { viewed: number; total: number }) {
  const complete = total > 0 && viewed >= total;
  const pct = total > 0 ? viewed / total : 0;
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      role="progressbar"
      aria-valuenow={viewed}
      aria-valuemax={total}
      aria-label={`${viewed} of ${total} notes read`}
      className="me-2 flex-shrink-0"
    >
      <circle
        cx={12}
        cy={12}
        r={radius}
        fill="none"
        strokeWidth={4}
        className="stroke-muted"
        strokeDashoffset={0}
        strokeLinecap="round"
      />
      <circle
        cx={12}
        cy={12}
        r={radius}
        fill="none"
        strokeWidth={4}
        className={complete ? "stroke-emerald-500" : "stroke-blue-500"}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

/** Canonical corpus order = index iteration order (topic → subtopic → note). */
function flatNotes(index: RevisionNotesIndexView): { noteId: string; title: string }[] {
  return index.topics.flatMap((t) => t.subtopics.flatMap((s) => s.notes));
}

function neighborTitle(
  index: RevisionNotesIndexView,
  noteId: string,
  offset: number,
): string | null {
  const flat = flatNotes(index);
  const at = flat.findIndex((n) => n.noteId === noteId);
  return at >= 0 ? flat[at + offset]?.title ?? null : null;
}

export function RevisionNotesView() {
  const [index, setIndex] = useState<RevisionNotesIndexView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"reader" | "topics">("reader");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [body, setBody] = useState<RevisionNoteBodyView | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);

  // noteId → viewedAt; seeded from the index, updated optimistically on open
  const [viewed, setViewed] = useState<Map<string, string>>(new Map());

  const [openTopics, setOpenTopics] = useState<Set<number>>(new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());

  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.revisionNotes();
      setIndex(data);
      setViewed(new Map(data.viewed.map((v) => [v.noteId, v.viewedAt])));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load revision notes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIndex();
  }, [loadIndex]);

  // locate a note in the canonical tree (topic order, subtopic, meta)
  const location = useMemo(() => {
    if (!index) return null;
    for (const topic of index.topics) {
      for (const sub of topic.subtopics) {
        for (const note of sub.notes) {
          if (note.noteId === selectedNoteId) {
            return { topic, sub, note };
          }
        }
      }
    }
    return null;
  }, [index, selectedNoteId]);

  const openNote = useCallback(
    async (noteId: string, target: { topicOrder: number; key: string } | null) => {
      setSelectedNoteId(noteId);
      setViewMode("reader");
      if (target) {
        setOpenTopics(new Set([target.topicOrder]));
        setOpenSubs(new Set([target.key]));
      }
      setBodyLoading(true);
      setBody(null);
      try {
        const data = await api.revisionNote(noteId);
        setBody(data);
        // SME semantics: opening a note marks it viewed — backend-backed here.
        if (!viewed.has(noteId)) {
          setViewed((prev) => new Map(prev).set(noteId, new Date().toISOString()));
          try {
            await api.markRevisionNoteViewed(noteId);
          } catch {
            // optimistic entry stands; the next index load reconciles honestly
          }
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load note");
      } finally {
        setBodyLoading(false);
      }
    },
    [viewed],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (error && !index) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Revision notes unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!index || index.topics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-5" /> Revision Notes
          </CardTitle>
          <CardDescription>
            The revision-note corpus has not been set up yet. Once the operator
            ingests the pilot corpus, your topics will appear here — organised
            by topic and subtopic, with progress rings as you read.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const totalNotes = index.topics.reduce(
    (acc, t) => acc + t.subtopics.reduce((a, s) => a + s.noteCount, 0),
    0,
  );
  const viewedCount = viewed.size;

  const sidebar = (
    <aside className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">Revision Notes</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setViewMode(viewMode === "reader" ? "topics" : "reader")}
        >
          <LayoutGrid className="size-3.5" />
          {viewMode === "reader" ? "View all topics" : "Close overview"}
        </Button>
      </div>
      <div className="px-3 py-1.5 text-xs text-muted-foreground">
        {index.topics.length} Topics · {totalNotes} Notes · {viewedCount} read
      </div>
      <nav aria-label="Revision note topics" className="pb-2">
        {index.topics.map((topic) => {
          const open = openTopics.has(topic.order);
          const noteCount = topic.subtopics.reduce((a, s) => a + s.noteCount, 0);
          return (
            <div key={topic.order}>
              <button
                type="button"
                className="flex w-full items-center gap-1 px-3 py-2 text-start text-sm font-medium hover:bg-muted/60"
                onClick={() =>
                  setOpenTopics((prev) => {
                    const next = new Set(prev);
                    if (next.has(topic.order)) next.delete(topic.order);
                    else next.add(topic.order);
                    return next;
                  })
                }
              >
                {open ? (
                  <ChevronDown className="size-4 flex-shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1">{topic.title}</span>
              </button>
              {open && (
                <div className="text-xs text-muted-foreground">
                  {topic.subtopics.map((sub) => {
                    const key = `${topic.order}.${sub.order}`;
                    const subOpen = openSubs.has(key);
                    const subViewed = sub.notes.filter((n) => viewed.has(n.noteId)).length;
                    return (
                      <div key={key} className="ms-5">
                        <button
                          type="button"
                          className="flex w-full items-center py-1.5 text-start hover:bg-muted/60"
                          onClick={() =>
                            setOpenSubs((prev) => {
                              const next = new Set(prev);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        >
                          <ProgressRing viewed={subViewed} total={sub.noteCount} />
                          <span className="flex-1 font-medium text-foreground/90">
                            {sub.title.replace(/^[a-z]+\. /, "")}
                          </span>
                          <span className="me-1 tabular-nums">
                            {subViewed}/{sub.noteCount}
                          </span>
                          {subOpen ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </button>
                        {subOpen && (
                          <ul className="ms-9 border-s pb-1">
                            {sub.notes.map((note) => (
                              <li key={note.noteId}>
                                <button
                                  type="button"
                                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-start hover:bg-muted/60 ${
                                    note.noteId === selectedNoteId
                                      ? "bg-muted font-medium text-foreground"
                                      : "text-muted-foreground"
                                  }`}
                                  onClick={() =>
                                    openNote(note.noteId, {
                                      topicOrder: topic.order,
                                      key,
                                    })
                                  }
                                >
                                  <FileText className="size-3.5 flex-shrink-0" />
                                  <span className="flex-1">{note.title}</span>
                                  {viewed.has(note.noteId) && (
                                    <CheckCircle2 className="size-3.5 flex-shrink-0 text-emerald-500" />
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );

  const topicsGrid = (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">All topics</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {index.topics.map((topic) => (
          <Card key={topic.order}>
            <CardHeader>
              <CardTitle className="text-base">{topic.title}</CardTitle>
              <CardDescription>
                {topic.subtopics.length} Topics ·{" "}
                {topic.subtopics.reduce((a, s) => a + s.noteCount, 0)} Notes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {topic.subtopics.map((sub) => {
                const key = `${topic.order}.${sub.order}`;
                const subViewed = sub.notes.filter((n) => viewed.has(n.noteId)).length;
                const open = openSubs.has(`grid-${key}`);
                return (
                  <div key={key}>
                    <button
                      type="button"
                      className="flex w-full items-center rounded px-1 py-1.5 text-start text-sm hover:bg-muted/60"
                      onClick={() =>
                        setOpenSubs((prev) => {
                          const next = new Set(prev);
                          if (next.has(`grid-${key}`)) next.delete(`grid-${key}`);
                          else next.add(`grid-${key}`);
                          return next;
                        })
                      }
                    >
                      <ProgressRing viewed={subViewed} total={sub.noteCount} />
                      <span className="flex-1 font-medium">{sub.title}</span>
                      <span className="me-1 text-xs text-muted-foreground tabular-nums">
                        {subViewed}/{sub.noteCount}
                      </span>
                      {open ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    {open && (
                      <ul className="ms-8 mb-2 border-s">
                        {sub.notes.map((note) => (
                          <li key={note.noteId}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-start text-sm hover:bg-muted/60"
                              onClick={() =>
                                openNote(note.noteId, {
                                  topicOrder: topic.order,
                                  key,
                                })
                              }
                            >
                              <FileText className="size-3.5 flex-shrink-0" />
                              <span className="flex-1">{note.title}</span>
                              {viewed.has(note.noteId) && (
                                <CheckCircle2 className="size-3.5 flex-shrink-0 text-emerald-500" />
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {sidebar}
      <div>
        {viewMode === "topics" ? (
          topicsGrid
        ) : !selectedNoteId ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-5" /> Revision Notes
              </CardTitle>
              <CardDescription>
                Pick a topic from the sidebar — notes are ordered to match the
                specification, and each subtopic&apos;s ring fills as you read.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {index.topics.map((topic) => (
                <Button
                  key={topic.order}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOpenTopics(new Set([topic.order]));
                    setViewMode("reader");
                  }}
                >
                  {topic.title}
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : bodyLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : body && location ? (
          <article className="rounded-lg border bg-card">
            <div className="border-b px-5 py-4">
              <p className="text-xs text-muted-foreground">
                {location.topic.title} · {location.sub.title}
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight">
                {body.title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">4CH1</Badge>
                {location.note.specPointCodes.map((code) => (
                  <Badge key={code} variant="secondary" className="font-mono text-[10px]">
                    {code}
                  </Badge>
                ))}
                {viewed.has(body.noteId) && (
                  <span className="ms-auto inline-flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="size-3.5" /> Read
                  </span>
                )}
              </div>
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none px-5 py-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ alt, src }) => {
                    const filename =
                      typeof src === "string" ? src.replace(/^assets\//, "") : "";
                    return <AuthedDiagram alt={alt ?? ""} filename={filename} />;
                  },
                  table: ({ children }) => (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:px-2 [&_th]:py-1">
                        {children}
                      </table>
                    </div>
                  ),
                }}
              >
                {body.bodyMd}
              </ReactMarkdown>
            </div>
            <div className="flex items-stretch justify-between gap-3 border-t px-5 py-3">
              {body.prevNoteId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="max-w-[45%] justify-start"
                  onClick={() => openNote(body.prevNoteId!, null)}
                >
                  <span className="truncate">
                    ← {neighborTitle(index, body.prevNoteId, 0) ?? "Previous"}
                  </span>
                </Button>
              ) : (
                <span />
              )}
              {body.nextNoteId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="max-w-[45%] justify-end"
                  onClick={() => openNote(body.nextNoteId!, null)}
                >
                  <span className="truncate">
                    {neighborTitle(index, body.nextNoteId, 0) ?? "Next"} →
                  </span>
                </Button>
              ) : (
                <span />
              )}
            </div>
          </article>
        ) : (
          <Alert>
            <AlertTitle>Note unavailable</AlertTitle>
            <AlertDescription>{error ?? "Select a note to read it."}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

/** Authenticated diagram: blob-fetches the corpus asset through the learner API. */
function AuthedDiagram({ alt, filename }: { alt: string; filename: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(() => !filename);

  useEffect(() => {
    if (!filename) return;
    let active = true;
    fetchRevisionNoteAsset(filename)
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
  return <img src={url} alt={alt} className="my-2 max-w-full rounded border" />;
}
