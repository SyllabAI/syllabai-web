import { AppShell } from "@/components/layout/app-shell";

/**
 * Hub chrome for every /courses route — the adapted SME-style shell
 * (header · theme toggle · workbench link). Per-course layout nested below
 * mounts the course sidebar (course-shell).
 */
export default function CoursesLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
