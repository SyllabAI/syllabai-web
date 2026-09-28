/**
 * Course header block — breadcrumb trail, bold qualification title, exam-code
 * pill and the Course Resources / Strengths & Weaknesses tab pair, mirroring
 * the SME hub anatomy (research §4, figures 1–2).
 */
import Link from "next/link";
import { Breadcrumbs, ExamCodePill } from "@/components/hub/chrome";
import { cn } from "@/lib/utils";
import type { CourseMeta } from "@/lib/courses";

export function CourseHeader({
  meta,
  activeTab = "resources",
  title,
  description,
  crumb,
  showTabs = false,
  children,
}: {
  meta: Pick<CourseMeta, "level" | "subject" | "label" | "code" | "slug">;
  activeTab?: "resources" | "strengths";
  title: string;
  description?: string;
  /** Final breadcrumb label — the current page's name (SME trail, figure 14:
   *  "IGCSE / Chemistry / Edexcel / Exam Questions / {topic}"). Defaults to
   *  "Edexcel", matching the hub-root trail. */
  crumb?: string;
  /** SME anatomy: the Course Resources / Strengths & Weaknesses tab pair
   *  belongs to the course hub root only — resource pages render breadcrumb +
   *  title without hub tabs (flow crawl 2026-09-19). */
  showTabs?: boolean;
  children?: React.ReactNode;
}) {
  const base = `/courses/${meta.slug}`;
  const tabs = [
    { id: "resources", label: "Course Resources", href: base },
    { id: "strengths", label: "Strengths & Weaknesses", href: `${base}/strengths` },
  ] as const;

  return (
    <header className="space-y-4">
      <Breadcrumbs
        items={[
          { label: meta.level, href: "/courses" },
          { label: meta.label, href: base },
          { label: crumb ?? "Edexcel" },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          {title}
        </h1>
        <ExamCodePill code={meta.code} />
      </div>
      {description && (
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
          {description}
        </p>
      )}
      {children}
      {showTabs && (
        <nav aria-label="Hub tabs" className="flex gap-6 border-b">
          {tabs.map((t) => (
            <Link
              key={t.id}
              href={t.href}
              aria-current={activeTab === t.id ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors",
                activeTab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
