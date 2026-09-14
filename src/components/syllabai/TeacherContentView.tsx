"use client";

/**
 * Teacher content-validation surface (Master Spec §7): the queue of SUGGESTED
 * past papers, the full review payload of each paper (content + answer key +
 * mark-scheme state), and the validate/reject workflow that decides whether
 * imported assessment content ever becomes student-servable.
 *
 * Safety posture carried through the UI:
 * - nothing here bypasses the backend gates: /api/v1/teacher/** enforces the
 *   role server-side, a 409 from paper validation is shown verbatim ("validate
 *   versions first"), and REJECTED/VALIDATED states are irreversible flips the
 *   backend owns — the buttons only trigger them;
 * - the answer key (correct option, misconception feed, mark points) is shown
 *   because a reviewer must see WHAT they validate — this view is the only
 *   place it appears; learner surfaces stay behind the serving boundary.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  TeacherPaperReviewView,
  TeacherReviewQueueView,
  TeacherVersionReview,
} from "@/lib/types";
import { Check, ChevronDown, ChevronRight, RefreshCw, ShieldCheck, X } from "lucide-react";

const stateBadgeClass: Record<string, string> = {
  SUGGESTED: "border-amber-300 bg-amber-50 text-amber-800",
  VALIDATED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  REJECTED: "border-rose-300 bg-rose-50 text-rose-800",
};

function StateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-xs text-muted-foreground">no scheme</span>;
  return (
    <Badge variant="outline" className={stateBadgeClass[state] ?? ""}>
      {state.toLowerCase()}
    </Badge>
  );
}

function VersionReviewCard({
  version,
  busy,
  onAction,
}: {
  version: TeacherVersionReview;
  busy: string | null;
  onAction: (action: "version-validate" | "version-reject" | "scheme-validate" | "scheme-reject", v: TeacherVersionReview) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {version.externalRef ? `${version.externalRef} — ` : ""}
            {version.stem}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {version.type.toLowerCase()} · {version.marks} mark{version.marks === 1 ? "" : "s"}
            {version.commandWord ? ` · ${version.commandWord.toLowerCase()}` : ""} · v{version.version}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StateBadge state={version.validationState} />
          {open ? (
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t p-3">
          {version.options.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Options (answer key)
              </p>
              <ul className="space-y-1">
                {version.options.map((o) => (
                  <li key={o.id} className="flex items-start gap-2 text-sm">
                    <span
                      className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        o.correct ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {o.label}
                    </span>
                    <span className="min-w-0">
                      {o.text}
                      {o.correct && (
                        <span className="ml-2 text-xs font-medium text-emerald-700">correct</span>
                      )}
                      {!o.correct && o.misconceptionNodeId && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          misconception trap
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {version.parts.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Parts
              </p>
              <ul className="space-y-1.5">
                {version.parts.map((p) => (
                  <li key={p.id} className="text-sm">
                    <span className="font-medium">{p.label}.</span> {p.prompt}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({p.marks} mark{p.marks === 1 ? "" : "s"}
                      {p.commandWord ? ` · ${p.commandWord.toLowerCase()}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {version.schemeState && (
            <div>
              <p className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>Mark scheme</span>
                <StateBadge state={version.schemeState} />
              </p>
              <ul className="space-y-1.5">
                {version.points.map((pt) => (
                  <li key={pt.id} className="text-sm">
                    <span className="font-medium">{pt.ref ?? "•"}</span> {pt.text}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({pt.marks} mark{pt.marks === 1 ? "" : "s"})
                    </span>
                    {pt.acceptanceCriteria.length > 0 && (
                      <ul className="mt-0.5 list-disc pl-5 text-xs text-muted-foreground">
                        {pt.acceptanceCriteria.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-800"
              disabled={busy !== null}
              onClick={() => onAction("version-validate", version)}
            >
              <Check className="size-4" aria-hidden="true" />
              {busy === "version-validate" ? "Validating…" : "Validate version"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-rose-800"
              disabled={busy !== null}
              onClick={() => onAction("version-reject", version)}
            >
              <X className="size-4" aria-hidden="true" />
              {busy === "version-reject" ? "Rejecting…" : "Reject version"}
            </Button>
            {version.schemeId && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-emerald-800"
                  disabled={busy !== null}
                  onClick={() => onAction("scheme-validate", version)}
                >
                  <Check className="size-4" aria-hidden="true" />
                  {busy === "scheme-validate" ? "Validating…" : "Validate scheme"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-rose-800"
                  disabled={busy !== null}
                  onClick={() => onAction("scheme-reject", version)}
                >
                  <X className="size-4" aria-hidden="true" />
                  {busy === "scheme-reject" ? "Rejecting…" : "Reject scheme"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TeacherContentView() {
  const [queue, setQueue] = useState<TeacherReviewQueueView | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [openPaperId, setOpenPaperId] = useState<string | null>(null);
  const [review, setReview] = useState<TeacherPaperReviewView | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      setQueue(await api.contentReviewQueue());
    } catch (err) {
      setQueueError(err instanceof ApiError ? err.message : "review queue unavailable");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const openPaper = useCallback(async (paperId: string) => {
    if (openPaperId === paperId) {
      setOpenPaperId(null);
      setReview(null);
      return;
    }
    setOpenPaperId(paperId);
    setReviewLoading(true);
    setReviewError(null);
    try {
      setReview(await api.paperReview(paperId));
    } catch (err) {
      setReviewError(err instanceof ApiError ? err.message : "paper review unavailable");
    } finally {
      setReviewLoading(false);
    }
  }, [openPaperId]);

  const act = useCallback(
    async (
      action: "version-validate" | "version-reject" | "scheme-validate" | "scheme-reject" | "paper-validate" | "paper-reject",
      version: TeacherVersionReview | null,
    ) => {
      if (!review) return;
      setBusy(action);
      setNotice(null);
      try {
        if (version) {
          if (action === "version-validate") {
            const r = await api.validateQuestionVersion(version.versionId);
            setNotice(`Question version validated (${r.version}).`);
          } else if (action === "version-reject") {
            const r = await api.rejectQuestionVersion(version.versionId);
            setNotice(`Question version rejected (${r.version}).`);
          } else if (action === "scheme-validate" && version.schemeId) {
            const r = await api.validateMarkScheme(version.schemeId);
            setNotice(`Mark scheme validated (${r.pointCount} points).`);
          } else if (action === "scheme-reject" && version.schemeId) {
            const r = await api.rejectMarkScheme(version.schemeId);
            setNotice("Mark scheme rejected.");
          }
        } else if (action === "paper-validate") {
          const r = await api.validatePaper(review.paper.id);
          setNotice(`Paper validated — content is now student-servable (${r.validationState.toLowerCase()}).`);
        } else if (action === "paper-reject") {
          await api.rejectPaper(review.paper.id);
          setNotice("Paper rejected — content will never serve to students.");
        }
        // refresh both layers: the paper view and the queue counts/states
        const fresh = await api.paperReview(review.paper.id);
        setReview(fresh);
        setQueue(await api.contentReviewQueue());
      } catch (err) {
        // 409s are the workflow's own guardrails — surface them verbatim
        setNotice(err instanceof ApiError ? err.message : "action failed");
      } finally {
        setBusy(null);
      }
    },
    [review],
  );

  if (queueLoading && !queue) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (queueError) {
    return (
      <Alert variant="destructive">
        <ShieldCheck className="size-4" aria-hidden="true" />
        <AlertTitle>Review queue unavailable</AlertTitle>
        <AlertDescription>{queueError}</AlertDescription>
      </Alert>
    );
  }

  const papers = queue?.papers ?? [];
  const allVersionsValidated =
    review != null &&
    review.versions.length > 0 &&
    review.versions.every((v) => v.validationState === "VALIDATED");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>Content validation queue (§7)</span>
            <Button size="sm" variant="ghost" onClick={loadQueue} disabled={queueLoading}>
              <RefreshCw className={`size-4 ${queueLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              Refresh
            </Button>
          </CardTitle>
          <CardDescription>
            Imported assessment content stays SUGGESTED — invisible to students — until each
            question version and its mark scheme are validated here. Validating the paper flips
            it student-servable; rejecting removes it permanently.
            {queue && (
              <span className="mt-1 block">
                {papers.length} paper{papers.length === 1 ? "" : "s"} ·{" "}
                {queue.suggestedVersions} suggested question version
                {queue.suggestedVersions === 1 ? "" : "s"} · {queue.suggestedSchemes} suggested mark
                scheme{queue.suggestedSchemes === 1 ? "" : "s"}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {papers.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing awaiting validation. Ingested papers will appear here.
            </p>
          )}
          {papers.map((p) => (
            <div key={p.id} className="rounded-lg border">
              <button
                type="button"
                onClick={() => openPaper(p.id)}
                className="flex w-full items-center justify-between gap-3 p-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {[p.board, p.qualification, p.paperCode, p.sessionLabel].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StateBadge state={p.validationState} />
                  {openPaperId === p.id ? (
                    <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
              </button>

              {openPaperId === p.id && (
                <div className="space-y-3 border-t p-3">
                  {reviewLoading && <Skeleton className="h-16 w-full" />}
                  {reviewError && (
                    <p className="text-sm text-destructive">{reviewError}</p>
                  )}
                  {review && !reviewLoading && (
                    <>
                      {review.versions.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          This paper has no question versions (empty import).
                        </p>
                      )}
                      <div className="space-y-2">
                        {review.versions.map((v) => (
                          <VersionReviewCard key={v.versionId} version={v} busy={busy} onAction={(a, ver) => act(a, ver)} />
                        ))}
                      </div>
                      {review.versions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                          <Button
                            size="sm"
                            disabled={busy !== null || !allVersionsValidated}
                            title={
                              allVersionsValidated
                                ? undefined
                                : "Validate every question version (and its scheme) first"
                            }
                            onClick={() => act("paper-validate", null)}
                          >
                            <Check className="size-4" aria-hidden="true" />
                            {busy === "paper-validate" ? "Validating…" : "Validate paper → student-servable"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-rose-800"
                            disabled={busy !== null}
                            onClick={() => act("paper-reject", null)}
                          >
                            <X className="size-4" aria-hidden="true" />
                            {busy === "paper-reject" ? "Rejecting…" : "Reject paper"}
                          </Button>
                          {!allVersionsValidated && (
                            <span className="text-xs text-muted-foreground">
                              The backend requires every question version validated before the
                              paper can flip (409 otherwise).
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {notice && (
            <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              {notice}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
