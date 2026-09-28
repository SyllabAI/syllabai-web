"use client";

/**
 * CourseDataContext — the course layout loads the hub SidebarData once and
 * shares it with every client chrome consumer under the course shell
 * (sidebar, resource topic panel, mobile drawer). One canonical course
 * dataset, many chrome consumers (SME model, research §4).
 */
import { createContext, useContext } from "react";
import type { SpecTree } from "@/lib/spec-tree";

export type SidebarVariant = "hub" | "notes" | "questions" | "flashcards";

export interface SidebarData {
  course: { slug: string; subject: string; label?: string; level: string; code: string };
  tree: SpecTree;
  /** sub-topic code → per-resource counts */
  counts: Record<string, { notes: number; questions: number; flashcards: number }>;
  /** sub-topic code → canonical link per resource */
  hrefs: {
    notes: Record<string, string>;
    questions: Record<string, string>;
    flashcards: Record<string, string>;
  };
  /** noteId → sub-topic code (so the reader page can highlight its row) */
  noteSubtopic: Record<string, string | null>;
  /** sub-topic code → the individual notes anchored there, corpus order (tree expander) */
  notesBySubtopic: Record<string, { noteId: string; title: string; guidedStudy: boolean }[]>;
  /** sub-topic code → the individual question sets anchored there, corpus order (tree expander) */
  setsBySubtopic: Record<string, { slug: string; title: string; count: number }[]>;
  /** does the bundle carry real past-paper provenance (sourcePaper on parts)? */
  hasPastPapers?: boolean;
  /** does the syllabai-pastpapers archive hold PDFs mapped to this course? */
  hasCorpusPapers?: boolean;
}

const CourseDataContext = createContext<SidebarData | null>(null);

export function CourseDataProvider({
  data,
  children,
}: {
  data: SidebarData;
  children: React.ReactNode;
}) {
  return <CourseDataContext.Provider value={data}>{children}</CourseDataContext.Provider>;
}

export function useCourseData(): SidebarData {
  const v = useContext(CourseDataContext);
  if (!v) throw new Error("useCourseData must be used inside a CourseDataProvider");
  return v;
}

export function resourceIndexHref(base: string, variant: SidebarVariant): string {
  if (variant === "notes") return `${base}/revision-notes`;
  if (variant === "questions") return `${base}/exam-questions`;
  if (variant === "flashcards") return `${base}/flashcards`;
  return base;
}
