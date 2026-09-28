"use client";

/**
 * AppShell — hub chrome for the Learning Hub routes (/courses, /dashboard),
 * SaveMyExams-style (research §4, flow crawl 2026-09-19): a single header
 * (logo · navigation · dual-theme toggle) and NO global sidebar. SME keeps
 * all global navigation in the header; course surfaces add exactly one
 * course sidebar (course-shell) and resource detail pages add the topic
 * panel (resource-panel).
 *
 * Web adaptation of the demo shell (2026-09-28 import): the mock identity
 * and demo provider badges are gone — "Sign in" routes to the production
 * workbench (/), which owns real authentication against syllabai-core.
 * Course pages manage their own horizontal rhythm (course shell + resource
 * panel); every other hub page gets the centred content column.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Atom,
  BookOpenCheck,
  GraduationCap,
  LayoutDashboard,
  LogIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { isImmersiveRoute } from "@/lib/focus-routes";
import { cn } from "@/lib/utils";

const TOOLS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, desc: "My subjects" },
  { href: "/courses", label: "Courses", icon: GraduationCap, desc: "All Learning Hubs" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // course pages manage their own horizontal rhythm (course shell + resource
  // panel); every other hub page gets the centred content column
  const inCourse = pathname.startsWith("/courses/");
  const bare = inCourse;

  return (
    <div className="min-h-screen bg-background">
      {/* solid header (SME parity): a translucent bar lets large H1 text bleed
          through on scroll and reads as a rendering glitch (UX audit 2026-09-19) */}
      <header className="sticky top-0 z-40 border-b bg-background print:hidden">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          <Link href="/courses" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Atom className="size-4" aria-hidden />
            </span>
            <span className="font-display font-semibold tracking-tight">syllabai</span>
          </Link>

          <nav className="flex items-center gap-1" aria-label="Hub">
            {TOOLS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                  "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <t.icon className="size-4" aria-hidden />
                <span className="hidden sm:inline">{t.label}</span>
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <Button asChild variant="outline" size="sm" className="hidden gap-1.5 sm:inline-flex">
              <Link href="/">
                <BookOpenCheck className="size-3.5" aria-hidden />
                Workbench
              </Link>
            </Button>
            <Button asChild size="sm" className="hidden gap-1.5 sm:inline-flex">
              <Link href="/dashboard">
                <LogIn className="size-3.5" aria-hidden />
                Start studying
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* content */}
      <main className={cn("min-w-0 flex-1", !bare && "px-4 py-6 sm:px-6 lg:px-8")}>
        {bare ? children : <div className="mx-auto w-full max-w-6xl">{children}</div>}
      </main>

      {/* footer — provenance + demo discipline live here, not in the learner
          path. On document-focus routes (paper viewer / player) it is omitted
          entirely: the panes fill the viewport exactly, and a footer below the
          fold would create a pointless 200px page scroll. */}
      {!isImmersiveRoute(pathname) && (
      <footer className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6 lg:px-8 print:hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-4">
          <ThemeToggle variant="row" />
          <span className="text-[11px] text-muted-foreground">
            hub discipline: canonical educational truth lives in{" "}
            <span className="font-mono">syllabai-core</span> + the operator corpora; learner
            progress shown on hub surfaces is <span className="font-mono">SIMULATED</span>{" "}
            until wired to the core learner model (pilot: 4CH1 Chemistry); everything
            AI-suggested keeps its provenance.
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          SyllabAI Learning Hubs — course resources from the operator-authorized Save My
          Exams corpus (operator licensing attestation 2026-09-28). Canonical semantics:
          <span className="font-mono"> syllabai/syllabai</span> · content:
          <span className="font-mono"> syllabai-resources</span>.
        </p>
      </footer>
      )}
    </div>
  );
}
