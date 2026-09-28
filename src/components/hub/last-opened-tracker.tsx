"use client";

/**
 * LastOpenedTracker — invisible island mounted once per course route tree
 * (course layout). Records real navigation into the last-opened store so
 * the dashboard can show "Last viewed" + "Jump back in" (SME parity,
 * Task 21-b). Renders nothing.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordLastOpened, resourceFromPathname } from "@/lib/last-opened";

export function LastOpenedTracker() {
  const pathname = usePathname();

  useEffect(() => {
    const entry = resourceFromPathname(pathname);
    if (entry) recordLastOpened(entry.slug, entry.resource);
  }, [pathname]);

  return null;
}
