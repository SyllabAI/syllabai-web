"use client";

/**
 * Honest cold-start banner (Render free tier).
 *
 * The core spins down after ~15 min idle; the next request pays a full JVM +
 * Spring boot. The API client emits `syllabai:backend-waking` when a request
 * exceeds 3 s with no recent success, and `syllabai:backend-ok` on the first
 * response. This component listens and renders a slim, dismiss-free banner —
 * the point is to tell users the truth ("waking up, ~30–60 s") instead of a
 * silent spinner, NOT to hide the free-tier physics.
 */
import { useEffect, useState } from "react";
import { CloudCog, Loader2 } from "lucide-react";

export function BackendStatus() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    const onWaking = () => setWaking(true);
    const onOk = () => setWaking(false);
    window.addEventListener("syllabai:backend-waking", onWaking);
    window.addEventListener("syllabai:backend-ok", onOk);
    return () => {
      window.removeEventListener("syllabai:backend-waking", onWaking);
      window.removeEventListener("syllabai:backend-ok", onOk);
    };
  }, []);

  if (!waking) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 w-full border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-1.5 text-xs">
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <CloudCog className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          The SyllabAI server is waking up (free tier — it sleeps when idle).
          This can take up to a minute; your request will complete automatically.
        </span>
      </div>
    </div>
  );
}
