import { AppShell } from "@/components/layout/app-shell";

/** Hub chrome for the dashboard (my subjects, last viewed, jump back in). */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
