"use client";

/**
 * Learner exam-papers browser (Master Spec §6.5): the Save-My-Exams-style
 * "Exam Questions" surface — browse papers, open a validated question with its
 * parts, and reveal its mark scheme. Two honest boundaries, both inherited from
 * the backend:
 *   1. the serving gate — only questions under VALIDATED versions (and a
 *      non-rejected paper) serve; suggested rows stay metadata-only here,
 *   2. the reveal policy — /mark-scheme answers 204 while a scheme is pending
 *      teacher validation, which renders as an explicit "pending" state, never
 *      as fake content.
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
  MarkSchemePointView,
  MarkSchemeRevealView,
  StudentQuestionView,
  SubjectView,
} from "@/lib/types";
import { ChevronDown, ChevronRight, Eye, EyeOff, FileText, RefreshCw } from "lucide-react";

const stateBadgeClass: Record<string, string> = {
  VALIDATED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  SUGGESTED: "border-amber-300 bg-amber-50 text-amber-800",
  REJECTED: "border-rose-300 bg-rose-50 text-rose-800",
};

function MarksChip({ marks }: { marks: number }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
      {marks} mark{marks === 1 ? "" : "s"}
    </span>
  );
}

function PointList({ points }: { points: MarkSchemePointView[] }) {
  if (points.length === 0) return null;
  return (
    <ul className="space-y-1">
      {points.map((p, i) => (
        <li key={`${p.ref ?? "pt"}-${i}`} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 shrink-0 rounded border border-slate-300 bg-slate-50 px-1 text-[10px] font-medium text-slate-500">
            {p.ref ?? "•"}
          </span>
          <span className="min-w-0 flex-1">{p.text}</span>
          <MarksChip marks={p.marks} />
        </li>
      ))}
    </ul>
  );
}

function MarkSchemePanel({ questionId }: { questionId: string }) {
  const [scheme, setScheme] = useState<MarkSchemeRevealView | null>(null);
  const [withheld, setWithheld] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .markScheme(questionId)
      .then((result) => {
        if (cancelled) return;
        if (result) setScheme(result);
        else setWithheld(true); // 204: policy withholds — never fake content
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "mark scheme unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (withheld) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
        The mark scheme isn&apos;t open yet — it is awaiting teacher validation (or has been
        withdrawn). Content only appears here once it passes the review gate.
      </p>
    );
  }
  if (!scheme) return <Skeleton className="h-16 w-full" />;

  const suggested = scheme.validationState === "SUGGESTED";
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={
            suggested
              ? "border-amber-300 bg-amber-50 text-amber-800"
              : "border-emerald-300 bg-emerald-50 text-emerald-800"
          }
        >
          {suggested ? "AI-extracted — pending teacher validation" : scheme.validationState.toLowerCase()}
        </Badge>
        <MarksChip marks={scheme.schemeMarks} />
        {scheme.schemeMarks !== scheme.questionMarks && (
          <span className="text-[11px] text-muted-foreground">
            question total: {scheme.questionMarks}
          </span>
        )}
      </div>
      {scheme.parts.map((part) => (
        <div key={part.partId} className="rounded-md border p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {part.label ? `${part.label} ` : ""}
              <span className="font-normal text-muted-foreground">{part.prompt}</span>
            </p>
            <MarksChip marks={part.marks} />
          </div>
          <PointList points={part.points} />
          {part.points.length === 0 && (
            <p className="text-xs text-muted-foreground">No mark points recorded for this part yet.</p>
          )}
        </div>
      ))}
      {scheme.generalPoints.length > 0 && (
        <div className="rounded-md border p-2.5">
          <p className="mb-1 text-sm font-medium">Whole-question guidance</p>
          <PointList points={scheme.generalPoints} />
        </div>
      )}
    </div>
  );
}

function QuestionPanel({ questionId }: { questionId: string }) {
  const [question, setQuestion] = useState<StudentQuestionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showScheme, setShowScheme] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .question(questionId)
      .then((q) => {
        if (!cancelled) setQuestion(q);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "question unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (error) return <p className="p-3 text-sm text-destructive">{error}</p>;
  if (!question) return <div className="p-3"><Skeleton className="h-20 w-full" /></div>;

  return (
    <div className="space-y-3 border-t bg-slate-50/60 p-3">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <MarksChip marks={question.marks} />
          {question.commandWord && (
            <Badge variant="outline" className="border-slate-300 bg-white text-[11px] text-slate-600">
              {question.commandWord}
            </Badge>
          )}
          {question.expectedTimeSeconds > 0 && (
            <span className="text-[11px] text-muted-foreground">
              ≈ {Math.round(question.expectedTimeSeconds / 60)} min
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm">{question.stem}</p>
      </div>

      {question.parts.length > 0 && (
        <ol className="space-y-1.5">
          {question.parts.map((part) => (
            <li key={part.id} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 min-w-8 shrink-0 text-right font-medium text-slate-600">
                {part.label}
              </span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap">{part.prompt}</span>
              <MarksChip marks={part.marks} />
            </li>
          ))}
        </ol>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowScheme((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {showScheme ? (
            <>
              <EyeOff className="size-3.5" aria-hidden="true" /> Hide mark scheme
            </>
          ) : (
            <>
              <Eye className="size-3.5" aria-hidden="true" /> Show mark scheme
            </>
          )}
        </button>
        {showScheme && (
          <div className="mt-2.5">
            <MarkSchemePanel questionId={questionId} />
          </div>
        )}
      </div>
    </div>
  );
}

function PaperRow({ paperId }: { paperId: string }) {
  // mounted only while the row is expanded — detail state resets on unmount
  const [detail, setDetail] = useState<ExamPaperDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);

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
              {detail.questions.map((q) => {
                const open = q.versionValidationState === "VALIDATED";
                const expanded = openQuestionId === q.questionId;
                return (
                  <li key={q.questionId} className="rounded-lg border">
                    <button
                      type="button"
                      disabled={!open}
                      onClick={() => setOpenQuestionId(expanded ? null : q.questionId)}
                      title={open ? undefined : "Awaiting teacher validation"}
                      className={`flex w-full items-center justify-between gap-3 p-2.5 text-left ${
                        open ? "hover:bg-slate-50" : "cursor-not-allowed opacity-70"
                      }`}
                    >
                      <span className="min-w-0 truncate text-sm">
                        {q.externalRef ? `${q.externalRef} — ` : ""}
                        {q.marks} mark{q.marks === 1 ? "" : "s"}
                        {q.partCount > 0
                          ? ` · ${q.partCount} part${q.partCount === 1 ? "" : "s"}`
                          : ""}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={stateBadgeClass[q.versionValidationState ?? ""] ?? ""}
                        >
                          {(q.versionValidationState ?? "unversioned").toLowerCase()}
                        </Badge>
                        {open &&
                          (expanded ? (
                            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                          ))}
                      </span>
                    </button>
                    {open && expanded && <QuestionPanel questionId={q.questionId} />}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Validated questions open with their full text and mark scheme; rows marked
            suggested are still awaiting a teacher and stay metadata-only.
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
          <span>Exam questions</span>
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
            ? "Past-paper questions for the selected subject."
            : "Every past-paper question registered in the pilot."}{" "}
          Open a validated question to view it with its mark scheme — suggested content is
          awaiting a teacher.
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
