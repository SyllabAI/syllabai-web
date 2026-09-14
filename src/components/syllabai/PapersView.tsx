"use client";

/**
 * Learner exam-papers browser (Master Spec §6.5): read-only list of past papers
 * with their validation state. Only VALIDATED papers serve questions through the
 * practice flow — SUGGESTED/REJECTED entries appear here with their state so the
 * pipeline stays visible and honest instead of silently hiding content.
 *
 * No question content is rendered: the browse endpoints expose metadata only and
 * the servable-question service keeps the answering surface validated-only.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { api, ApiError } from "@/lib/api";
import type {
  ExamPaperBrowseView,
  ExamPaperDetailView,
  SubjectView,
} from "@/lib/types";
import { ChevronDown, ChevronRight, FileText, RefreshCw } from "lucide-react";

const stateBadgeClass: Record<string, string> = {
  VALIDATED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  SUGGESTED: "border-amber-300 bg-amber-50 text-amber-800",
  REJECTED: "border-rose-300 bg-rose-50 text-rose-800",
};

function PaperRow({ paperId }: { paperId: string }) {
  // mounted only while the row is expanded — detail state resets on unmount
  const [detail, setDetail] = useState<ExamPaperDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .examPaper(paperId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  return (
    <div className="border-t p-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && !detail && <Skeleton className="h-14 w-full" />}
      {detail && (
        <div>
          {detail.questions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No questions registered for this paper yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {detail.questions.map((q) => (
                <li key={q.questionId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    {q.externalRef ? `${q.externalRef} — ` : ""}
                    {q.marks} mark{q.marks === 1 ? "" : "s"}
                    {q.partCount > 0 ? ` · ${q.partCount} part${q.partCount === 1 ? "" : "s"}` : ""}
                  </span>
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${
                      q.versionValidationState === "VALIDATED"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : "border-amber-300 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {(q.versionValidationState ?? "unversioned").toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Question text opens in the practice flow once a teacher validates it — the
            browse view never serves content ahead of validation.
          </p>
        </div>
      )}
    </div>
  );
}

export function PapersView({
  subjects,
  selectedSubjectId,
}: {
  subjects: SubjectView[];
  selectedSubjectId: string | null;
}) {
  const [papers, setPapers] = useState<ExamPaperBrowseView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async (subjectId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      setPapers(await api.examPapers(subjectId ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "papers unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selectedSubjectId);
  }, [load, selectedSubjectId]);

  if (loading && !papers) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <FileText className="size-4" aria-hidden="true" />
        <AlertTitle>Papers unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const list = papers ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span>Past papers</span>
          <button
            type="button"
            onClick={() => load(selectedSubjectId)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </button>
        </CardTitle>
        <CardDescription>
          {selectedSubjectId
            ? "Papers for the selected subject."
            : "Every paper registered in the pilot."}{" "}
          Only VALIDATED papers open in practice — SUGGESTED content is awaiting a teacher.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No papers registered yet. When a teacher validates imported past-paper content it
            will appear here — 4CH1 material is going through that gate now.
          </p>
        ) : (
          list.map((p) => (
            <div key={p.id} className="rounded-lg border">
              <button
                type="button"
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[p.board, p.qualification, p.paperCode, p.sessionLabel].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className={stateBadgeClass[p.validationState] ?? ""}>
                    {p.validationState.toLowerCase()}
                  </Badge>
                  {openId === p.id ? (
                    <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
              </button>
              {openId === p.id && <PaperRow paperId={p.id} />}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
