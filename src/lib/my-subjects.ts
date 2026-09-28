"use client";

/**
 * My Subjects — the student's personally added courses (SME flow step 1).
 *
 * The demo has no auth, so the roster persists in localStorage under a
 * versioned key. Slugs are validated against the course registry at read
 * time by the caller (the dashboard filters unknown slugs out).
 *
 * Implementation note: useSyncExternalStore keeps the roster reactive
 * across tabs (storage event) and across hook instances in this tab
 * (custom event) without setState-in-effect cascades.
 */
import { useCallback, useSyncExternalStore } from "react";

const KEY = "syllabai.mySubjects.v1";
export const MY_SUBJECTS_EVENT = "syllabai:my-subjects-changed";

const EMPTY: string[] = [];

function readSlugs(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch {
    return EMPTY;
  }
}

// getSnapshot must return a referentially stable value between store changes
let snapshot: string[] = EMPTY;
function getSnapshot(): string[] {
  const next = readSlugs();
  if (next.length !== snapshot.length || next.some((s, i) => s !== snapshot[i])) {
    snapshot = next;
  }
  return snapshot;
}
function getServerSnapshot(): string[] {
  return EMPTY;
}

function writeSlugs(slugs: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(slugs));
  } catch {
    // storage full / private mode — roster just won't persist
  }
  window.dispatchEvent(new CustomEvent(MY_SUBJECTS_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(MY_SUBJECTS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MY_SUBJECTS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export interface MySubjects {
  /** added course slugs, insertion order preserved */
  slugs: string[];
  has: (slug: string) => boolean;
  add: (slug: string) => void;
  remove: (slug: string) => void;
  toggle: (slug: string) => void;
  clear: () => void;
}

export function useMySubjects(): MySubjects {
  const slugs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const add = useCallback((slug: string) => {
    const cur = readSlugs();
    if (!cur.includes(slug)) writeSlugs([...cur, slug]);
  }, []);

  const remove = useCallback((slug: string) => {
    writeSlugs(readSlugs().filter((s) => s !== slug));
  }, []);

  const toggle = useCallback((slug: string) => {
    const cur = readSlugs();
    writeSlugs(cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]);
  }, []);

  const clear = useCallback(() => writeSlugs([]), []);

  const has = useCallback((slug: string) => slugs.includes(slug), [slugs]);

  return { slugs, has, add, remove, toggle, clear };
}
