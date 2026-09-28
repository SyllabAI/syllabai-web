import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadHubCourse } from "@/lib/courses";
import { hasPastPapers } from "@/lib/past-papers";
import { courseHasCorpusPapers } from "@/lib/pastpapers-corpus";
import { CourseShell, type SidebarData } from "@/components/hub/course-shell";
import { LastOpenedTracker } from "@/components/hub/last-opened-tracker";

export const dynamic = "force-dynamic";

/**
 * Per-course layout — mounts the persistent course sidebar (the ONE sidebar,
 * SaveMyExams model, research §4 + flow crawl 2026-09-19). Resource detail
 * pages additionally mount the topic panel (resource-panel.tsx) as SME's
 * second column; hub/index pages have sidebar-only chrome.
 */
export default async function CourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ course: string }>;
}) {
  const { course: slug } = await params;
  const hub = await loadHubCourse(slug);
  if (!hub) notFound();

  const data: SidebarData = {
    course: {
      slug: hub.meta.slug,
      subject: hub.meta.subject,
      label: hub.meta.label,
      level: hub.meta.level,
      code: hub.meta.code,
    },
    tree: hub.index.tree,
    counts: hub.counts,
    hrefs: hub.hrefs,
    noteSubtopic: hub.noteSubtopic,
    notesBySubtopic: hub.notesBySubtopic,
    setsBySubtopic: hub.setListsBySubtopic,
    hasPastPapers: hasPastPapers(hub.questionTopics),
    hasCorpusPapers: courseHasCorpusPapers(slug),
  };

  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading course…</div>}>
      <CourseShell data={data}>
        {/* records real navigation for the dashboard's Last viewed / Jump back in */}
        <LastOpenedTracker />
        {children}
      </CourseShell>
    </Suspense>
  );
}
