"use client";

/**
 * Teacher content-validation surface (Master Spec §7): the queue of SUGGESTED
 * past papers, the full review payload of each paper (content + answer key +
 * mark-scheme state), and the validate/reject/flag workflow that decides whether
 * imported assessment content ever becomes student-servable.
 *
 * V20 high-throughput review:
 * - the queue is the ENRICHED read model (review-queue-v2): strongest
 *   candidates first (bridge reconciliation OK, higher mean extraction
 *   confidence, fewer parser findings), with per-paper progress so a reviewer
 *   triages 90 papers without opening each one;
 * - batch "Validate all" flips every SUGGESTED version + scheme + the paper in
 *   one action — fail-closed against REVIEW_REQUIRED imports and REJECTED /
 *   FLAGGED versions (the backend 409s; the UI surfaces the reason verbatim
 *   and never bypasses it silently);
 * - FLAGGED state on papers, versions and schemes: "needs a second look".
 *   Flagging a VALIDATED item stops it serving immediately; unflag returns it
 *   to SUGGESTED — re-validation required, never straight back to VALIDATED;
 * - a plain-language lifecycle legend: a teacher must understand WHY content
 *   is in its state without developer knowledge.
 *
 * Safety posture carried through the UI:
 * - nothing here bypasses the backend gates: /api/v1/teacher/** enforces the
 *   role server-side, 409s are shown verbatim, and REJECTED/VALIDATED/FLAGGED
 *   are flips the backend owns — the buttons only trigger them;
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api, ApiError } from "@/lib/api";
import type { TeacherAuditRowView } from "@/lib/types";
import type {
  NodeView,
  SubjectView,
  TeacherEnrichedPaperSummary,
  TeacherEnrichedPaperSummaryV3,
  TeacherFindingView,
  TeacherPaperReviewView,
  TeacherTopicMappingResult,
  TeacherTopicRowView,
  TeacherVersionReview,
} from "@/lib/types";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Flag,
  FlagOff,
  Info,
  ListChecks,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";

const stateBadgeClass: Record<string, string> = {
  SUGGESTED: "border-amber-300 bg-amber-50 text-amber-800",
  VALIDATED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  REJECTED: "border-rose-300 bg-rose-50 text-rose-800",
  FLAGGED: "border-orange-300 bg-orange-50 text-orange-800",
};

function StateBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-xs text-muted-foreground">no scheme</span>;
  return (
    <Badge variant="outline" className={stateBadgeClass[state] ?? ""}>
      {state.toLowerCase()}
    </Badge>
  );
}

/** plain-language lifecycle explanation — the "WHY is it in this state" legend */
const LIFECYCLE_LEGEND: { state: string; explanation: string }[] = [
  {
    state: "SUGGESTED",
    explanation:
      "Imported by the pipeline, not yet reviewed. Students never see it until a teacher validates it.",
  },
  {
    state: "VALIDATED",
    explanation:
      "A teacher approved it. For question versions this is the gate that makes content student-servable.",
  },
  {
    state: "FLAGGED",
    explanation:
      "Marked for a second look (by a teacher). Serving stops immediately; unflagging returns it to SUGGESTED so it must be re-validated.",
  },
  {
    state: "REJECTED",
    explanation: "Removed by a teacher. It will never serve to students.",
  },
];

function LifecycleLegend() {
  return (
    <Alert>
      <Info className="size-4" aria-hidden="true" />
      <AlertTitle>Content lifecycle — why an item is in its current state</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 space-y-1">
          {LIFECYCLE_LEGEND.map((l) => (
            <li key={l.state} className="flex items-start gap-2">
              <StateBadge state={l.state} />
              <span>{l.explanation}</span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function confidenceBadgeClass(c: number | null): string | null {
  if (c == null) return null;
  if (c >= 0.8) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (c >= 0.5) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function QualityBadges({ paper }: { paper: TeacherEnrichedPaperSummary }) {
  const recon =
    paper.reconciliationStatus == null ? null : paper.reconciliationStatus === "OK";
  // sprint-2 §7 signals (present on the v3 queue; absent on plain v2 rows)
  const v3 = paper as TeacherEnrichedPaperSummaryV3;
  const hasV3 =
    typeof v3.totalQuestions === "number" && typeof v3.rankReasons !== "undefined";
  const schemeRatio =
    hasV3 && v3.totalQuestions > 0 ? v3.questionsWithScheme / v3.totalQuestions : null;
  const mappingRatio =
    hasV3 && v3.totalQuestions > 0 ? v3.mappedQuestions / v3.totalQuestions : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {recon != null && (
        <Badge
          variant="outline"
          className={
            recon
              ? "border-sky-200 bg-sky-50 text-sky-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }
        >
          {recon ? "marks reconciled" : "needs reconciliation review"}
        </Badge>
      )}
      {hasV3 && schemeRatio != null && schemeRatio >= 1 && (
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          scheme linked for all {v3.totalQuestions}
        </Badge>
      )}
      {hasV3 && schemeRatio != null && schemeRatio < 1 && (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
          scheme {v3.questionsWithScheme}/{v3.totalQuestions}
        </Badge>
      )}
      {hasV3 && mappingRatio != null && mappingRatio > 0 && (
        <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
          mapped {v3.mappedQuestions}/{v3.totalQuestions}
        </Badge>
      )}
      {hasV3 && v3.novelTopicCount > 0 && (
        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
          {v3.novelTopicCount} novel topic{v3.novelTopicCount === 1 ? "" : "s"}
        </Badge>
      )}
      {paper.findingCount > 0 && (
        <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
          <AlertTriangle className="mr-1 size-3" aria-hidden="true" />
          {paper.findingCount} finding{paper.findingCount === 1 ? "" : "s"}
        </Badge>
      )}
      {paper.avgExtractionConfidence != null && (
        <Badge variant="outline" className={confidenceBadgeClass(paper.avgExtractionConfidence) ?? ""}>
          extraction {(paper.avgExtractionConfidence * 100).toFixed(0)}%
        </Badge>
      )}
      {paper.versionCount > 0 && (
        <Badge variant="outline" className="border-muted bg-muted/50 text-muted-foreground">
          {paper.validatedVersions}/{paper.versionCount} versions validated
          {paper.flaggedVersions > 0 ? ` · ${paper.flaggedVersions} flagged` : ""}
          {paper.rejectedVersions > 0 ? ` · ${paper.rejectedVersions} rejected` : ""}
        </Badge>
      )}
    </div>
  );
}

/** sprint-2 §7: the human-legible ranking reasons under a queue row */
function RankReasons({ paper }: { paper: TeacherEnrichedPaperSummaryV3 }) {
  if (!paper.rankReasons || paper.rankReasons.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium">Why this rank:</span> {paper.rankReasons.join(" · ")}
    </p>
  );
}

function FindingsPanel({ paperId }: { paperId: string }) {
  const [findings, setFindings] = useState<TeacherFindingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || findings != null || error) return;
    api
      .paperFindings(paperId)
      .then((f) => setFindings(f))
      .catch((e) => {
        // 404 = no bridge record (e.g. teacher-authored) — honest empty, not an error
        if (e instanceof ApiError && e.status === 404) setFindings([]);
        else setError(e instanceof ApiError ? e.message : "findings unavailable");
      });
  }, [open, paperId, findings, error]);

  return (
    <div className="rounded-md border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 p-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {open ? (
          <ChevronDown className="size-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4" aria-hidden="true" />
        )}
        Import findings (parser + marks reconciliation)
      </button>
      {open && (
        <div className="border-t p-2.5">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {findings == null && !error && <Skeleton className="h-8 w-full" />}
          {findings != null && findings.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No findings recorded — the import reconciled cleanly.
            </p>
          )}
          {findings != null && findings.length > 0 && (
            <ul className="space-y-1">
              {findings.map((f, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium">{f.severity ?? f.source ?? "finding"}:</span>{" "}
                  {f.detail ?? JSON.stringify(f)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** V22: durable audit trail for this paper and everything under it (who/what/when) */
function AuditPanel({ paperId }: { paperId: string }) {
  const [rows, setRows] = useState<TeacherAuditRowView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || rows != null || error) return;
    api
      .paperAudit(paperId)
      .then((r) => setRows(r))
      .catch((e) => setError(e instanceof ApiError ? e.message : "audit unavailable"));
  }, [open, paperId, rows, error]);

  const fmtWhen = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="rounded-md border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 p-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {open ? (
          <ChevronDown className="size-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-4" aria-hidden="true" />
        )}
        Decision audit trail (V22)
      </button>
      {open && (
        <div className="border-t p-2.5">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {rows == null && !error && <Skeleton className="h-8 w-full" />}
          {rows != null && rows.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No audit rows yet — nothing has been decided on this paper since the V22 trail
              went live. Earlier decisions live in the server logs of that time.
            </p>
          )}
          {rows != null && rows.length > 0 && (
            <ul className="space-y-1">
              {rows.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium">{r.action}</span> {r.targetType.replace("_", " ")}{" "}
                  {r.fromState ? `${r.fromState} → ${r.toState}` : r.detail ? `— ${r.detail}` : ""}
                  {r.fromState ? (r.detail ? ` — ${r.detail}` : "") : ""}{" "}
                  <span className="font-mono">[{r.actor}]</span> {fmtWhen(r.occurredAt)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** a KG topic offered by the picker (TOPIC or SUBTOPIC nodes, anchors excluded) */
interface TopicOption {
  id: string;
  code: string;
  title: string;
  path: string; // "S1 · States of matter" style breadcrumb
}

function flattenTopics(node: NodeView, path: string[], out: TopicOption[]) {
  const nextPath = node.type === "SECTION" || node.type === "TOPIC" ? [...path, node.title] : path;
  if (node.type === "TOPIC" || node.type === "SUBTOPIC") {
    if (!node.code.startsWith("ING-")) {
      out.push({
        id: node.id,
        code: node.code,
        title: node.title,
        path: path.join(" · "),
      });
    }
  }
  (node.children ?? []).forEach((c) => flattenTopics(c, nextPath, out));
}

/**
 * §10 topic picker: searchable combobox over the subject's KG topics. Mapping
 * is a factual association (which topic this question tests) — it never flips
 * validation states. Until a question is mapped off its ingestion anchor,
 * subject-scoped practice cannot see it; the picker shows that anchor state.
 */
function TopicPicker({
  questionId,
  subjectRootId,
  onMapped,
}: {
  questionId: string;
  subjectRootId: string | null;
  onMapped: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<TopicOption[] | null>(null);
  const [current, setCurrent] = useState<TeacherTopicRowView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!subjectRootId || options != null) return;
    api
      .knowledgeTree(subjectRootId, false)
      .then((tree) => {
        const out: TopicOption[] = [];
        flattenTopics(tree, [], out);
        setOptions(out);
      })
      .catch(() => setOptions([]));
  }, [subjectRootId, options]);

  useEffect(() => {
    if (current == null) {
      api
        .questionTopicRows(questionId)
        .then(setCurrent)
        .catch(() => setCurrent([]));
    }
  }, [current, questionId]);

  const primaryRow = current?.find((r) => r.primary);
  const isAnchored =
    primaryRow != null && (primaryRow.code?.startsWith("ING-") ?? false);

  const pick = async (option: TopicOption) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.mapQuestionTopics(questionId, option.id);
      setCurrent(null); // refetch on next render
      onMapped(`Question mapped to ${r.primaryCode} — ${r.primaryTitle}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "mapping failed");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  if (!subjectRootId) {
    return (
      <p className="text-xs text-muted-foreground">
        Topic mapping needs the paper to be placed in a subject first.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {primaryRow ? (
          <span className="text-xs">
            {isAnchored ? (
              <>
                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                  unmapped (ingestion anchor)
                </Badge>{" "}
                <span className="text-muted-foreground">
                  students cannot practise this question until it is mapped to a real topic
                </span>
              </>
            ) : (
              <>
                <span className="font-medium">{primaryRow.code}</span>{" "}
                <span className="text-muted-foreground">{primaryRow.title}</span>
              </>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">no topic rows</span>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy || options == null}>
              <Search className="size-3.5" aria-hidden="true" />
              {busy ? "Mapping…" : "Map to curriculum topic"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search topics (e.g. electrolysis)…" />
              <CommandList>
                <CommandEmpty>No topics found.</CommandEmpty>
                {options != null &&
                  [...new Set(options.map((o) => o.path))].map((section) => (
                    <CommandGroup key={section} heading={section || "Topics"}>
                      {options
                        .filter((o) => o.path === section)
                        .map((o) => (
                          <CommandItem
                            key={o.id}
                            value={`${o.code} ${o.title}`}
                            onSelect={() => pick(o)}
                          >
                            <span className="font-mono text-xs text-muted-foreground">{o.code}</span>{" "}
                            {o.title}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function VersionReviewCard({
  version,
  busy,
  subjectRootId,
  onAction,
  onTopicMapped,
}: {
  version: TeacherVersionReview;
  busy: string | null;
  subjectRootId: string | null;
  onAction: (
    action:
      | "version-validate"
      | "version-reject"
      | "version-flag"
      | "version-unflag"
      | "scheme-validate"
      | "scheme-reject"
      | "scheme-flag"
      | "scheme-unflag",
    v: TeacherVersionReview,
  ) => void;
  onTopicMapped: (message: string) => void;
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
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>
              {version.type.toLowerCase()} · {version.marks} mark{version.marks === 1 ? "" : "s"}
              {version.commandWord ? ` · ${version.commandWord.toLowerCase()}` : ""} · v{version.version}
            </span>
            {version.extractionConfidence != null && (
              <Badge
                variant="outline"
                className={confidenceBadgeClass(version.extractionConfidence) ?? ""}
              >
                extraction {(version.extractionConfidence * 100).toFixed(0)}%
              </Badge>
            )}
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
          <TopicPicker
            questionId={version.questionId}
            subjectRootId={subjectRootId}
            onMapped={onTopicMapped}
          />
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
            {version.validationState !== "VALIDATED" && version.validationState !== "REJECTED" && (
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
            )}
            {version.validationState !== "REJECTED" && version.validationState !== "FLAGGED" && (
              <Button
                size="sm"
                variant="outline"
                className="text-orange-800"
                disabled={busy !== null}
                onClick={() => onAction("version-flag", version)}
              >
                <Flag className="size-4" aria-hidden="true" />
                Flag
              </Button>
            )}
            {version.validationState === "FLAGGED" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => onAction("version-unflag", version)}
              >
                <FlagOff className="size-4" aria-hidden="true" />
                {busy === "version-unflag" ? "Unflagging…" : "Unflag (back to suggested)"}
              </Button>
            )}
            {version.validationState !== "REJECTED" && version.validationState !== "VALIDATED" && version.validationState !== "FLAGGED" && (
              <Button
                size="sm"
                variant="outline"
                className="text-rose-800"
                disabled={busy !== null}
                onClick={() => onAction("version-reject", version)}
              >
                <X className="size-4" aria-hidden="true" />
                Reject version
              </Button>
            )}
            {version.schemeId && (
              <>
                {version.schemeState !== "VALIDATED" && version.schemeState !== "REJECTED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-emerald-800"
                    disabled={busy !== null}
                    onClick={() => onAction("scheme-validate", version)}
                  >
                    <Check className="size-4" aria-hidden="true" />
                    Validate scheme
                  </Button>
                )}
                {version.schemeState !== "REJECTED" && version.schemeState !== "FLAGGED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-orange-800"
                    disabled={busy !== null}
                    onClick={() => onAction("scheme-flag", version)}
                  >
                    <Flag className="size-4" aria-hidden="true" />
                    Flag scheme
                  </Button>
                )}
                {version.schemeState === "FLAGGED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => onAction("scheme-unflag", version)}
                  >
                    <FlagOff className="size-4" aria-hidden="true" />
                    Unflag scheme
                  </Button>
                )}
                {version.schemeState !== "REJECTED" && version.schemeState !== "VALIDATED" && version.schemeState !== "FLAGGED" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-rose-800"
                    disabled={busy !== null}
                    onClick={() => onAction("scheme-reject", version)}
                  >
                    <X className="size-4" aria-hidden="true" />
                    Reject scheme
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function TeacherContentView() {
  const [queue, setQueue] = useState<TeacherEnrichedPaperSummaryV3[] | null>(null);
  const [practicableTopicCount, setPracticableTopicCount] = useState<number | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [subjects, setSubjects] = useState<SubjectView[]>([]);
  const [placeSubjectId, setPlaceSubjectId] = useState<string | null>(null);

  const [openPaperId, setOpenPaperId] = useState<string | null>(null);
  const [review, setReview] = useState<TeacherPaperReviewView | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // the batch 409 for REVIEW_REQUIRED imports offers an explicit force retry
  const [forceOffer, setForceOffer] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      // sprint-2 §7: the v3 queue — scheme linkage, curriculum mapping and
      // novel-coverage signals plus the rank reasons, deterministically sorted
      const view = await api.contentReviewQueueV3();
      setQueue(view.papers);
      setPracticableTopicCount(view.practicableTopicCount);
    } catch (err) {
      setQueueError(err instanceof ApiError ? err.message : "review queue unavailable");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
    // subjects feed the §7 placement control (never guessed by the pipeline —
    // the reviewer picks the real curriculum subject here)
    api
      .subjects()
      .then(setSubjects)
      .catch(() => setSubjects([])); // honest empty: placement control shows unavailable
  }, [loadQueue]);

  const openPaper = useCallback(async (paperId: string) => {
    if (openPaperId === paperId) {
      setOpenPaperId(null);
      setReview(null);
      setForceOffer(null);
      return;
    }
    setOpenPaperId(paperId);
    setReviewLoading(true);
    setReviewError(null);
    setForceOffer(null);
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
      action:
        | "version-validate"
        | "version-reject"
        | "version-flag"
        | "version-unflag"
        | "scheme-validate"
        | "scheme-reject"
        | "scheme-flag"
        | "scheme-unflag"
        | "paper-validate"
        | "paper-reject"
        | "paper-place"
        | "paper-flag"
        | "paper-unflag"
        | "validate-all",
      version: TeacherVersionReview | null,
      force = false,
    ) => {
      if (!review) return;
      setBusy(action);
      setNotice(null);
      setForceOffer(null);
      try {
        if (version) {
          if (action === "version-validate") {
            const r = await api.validateQuestionVersion(version.versionId);
            setNotice(`Question version validated (${r.version}).`);
          } else if (action === "version-reject") {
            const r = await api.rejectQuestionVersion(version.versionId);
            setNotice(`Question version rejected (${r.version}).`);
          } else if (action === "version-flag") {
            const r = await api.flagQuestionVersion(version.versionId);
            setNotice(`Question version flagged (${r.validationState.toLowerCase()}) — it no longer serves.`);
          } else if (action === "version-unflag") {
            const r = await api.unflagQuestionVersion(version.versionId);
            setNotice(`Question version unflagged (${r.validationState.toLowerCase()}) — re-validation required.`);
          } else if (action === "scheme-validate" && version.schemeId) {
            const r = await api.validateMarkScheme(version.schemeId);
            setNotice(`Mark scheme validated (${r.pointCount} points).`);
          } else if (action === "scheme-reject" && version.schemeId) {
            const r = await api.rejectMarkScheme(version.schemeId);
            setNotice("Mark scheme rejected.");
          } else if (action === "scheme-flag" && version.schemeId) {
            const r = await api.flagMarkScheme(version.schemeId);
            setNotice(`Mark scheme flagged (${r.validationState.toLowerCase()}).`);
          } else if (action === "scheme-unflag" && version.schemeId) {
            const r = await api.unflagMarkScheme(version.schemeId);
            setNotice(`Mark scheme unflagged (${r.validationState.toLowerCase()}).`);
          }
        } else if (action === "validate-all") {
          const r = await api.validateAllForPaper(review.paper.id, force);
          setNotice(
            `Paper validated — ${r.versionsValidated} version(s) and ${r.schemesValidated} scheme(s) flipped; content is now student-servable.`,
          );
        } else if (action === "paper-validate") {
          const r = await api.validatePaper(review.paper.id);
          setNotice(`Paper validated — content is now student-servable (${r.validationState.toLowerCase()}).`);
        } else if (action === "paper-reject") {
          await api.rejectPaper(review.paper.id);
          setNotice("Paper rejected — content will never serve to students.");
        } else if (action === "paper-flag") {
          const r = await api.flagPaper(review.paper.id);
          setNotice(
            `Paper flagged (${r.validationState.toLowerCase()}) — serving of everything under it is blocked.`,
          );
        } else if (action === "paper-unflag") {
          const r = await api.unflagPaper(review.paper.id);
          setNotice(`Paper unflagged (${r.validationState.toLowerCase()}) — re-validation required.`);
        } else if (action === "paper-place") {
          if (!placeSubjectId) return;
          const target = subjects.find((s) => s.id === placeSubjectId);
          await api.placePaper(review.paper.id, placeSubjectId);
          setNotice(
            `Paper placed into ${target ? `${target.code} — ${target.name}` : "the selected subject"}. ` +
              "Placement is association only — validation states are unchanged.",
          );
        }
        // refresh both layers: the paper view and the queue counts/states
        const fresh = await api.paperReview(review.paper.id);
        setReview(fresh);
        const freshQueue = await api.contentReviewQueueV3();
        setQueue(freshQueue.papers);
        setPracticableTopicCount(freshQueue.practicableTopicCount);
      } catch (err) {
        // 409s are the workflow's own guardrails — surface them verbatim; the
        // REVIEW_REQUIRED batch guard additionally offers the explicit force retry
        const message = err instanceof ApiError ? err.message : "action failed";
        setNotice(message);
        if (
          action === "validate-all" &&
          err instanceof ApiError &&
          err.status === 409 &&
          message.includes("REVIEW_REQUIRED")
        ) {
          setForceOffer(review.paper.id);
        }
      } finally {
        setBusy(null);
      }
    },
    [review, subjects, placeSubjectId],
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

  const papers = queue ?? [];
  const allVersionsValidated =
    review != null &&
    review.versions.length > 0 &&
    review.versions.every((v) => v.validationState === "VALIDATED");
  const hasBlockedVersions =
    review != null &&
    review.versions.some(
      (v) => v.validationState === "REJECTED" || v.validationState === "FLAGGED",
    );

  return (
    <div className="space-y-4">
      <LifecycleLegend />

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
            Imported assessment content stays SUGGESTED — invisible to students — until validated
            here. The queue is deterministically ordered by defensible review signals (marks
            reconciled, scheme linkage, curriculum mapping, novel coverage, extraction
            confidence) with the reasons stated under each row — a triage aid that never
            promotes anything automatically.
            {practicableTopicCount != null && (
              <span className="ml-1 text-muted-foreground/80">
                {practicableTopicCount} topic{practicableTopicCount === 1 ? "" : "s"} practicable
                from validated content today.
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
                className="flex w-full items-start justify-between gap-3 p-3 text-left"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[p.board, p.qualification, p.paperCode, p.sessionLabel].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <QualityBadges paper={p} />
                  <RankReasons paper={p} />
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
                      {/* §7 placement: the pipeline never guesses the curriculum subject —
                          the reviewer places the paper into the real one here. */}
                      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2.5">
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Placement
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {(() => {
                            const current = subjects.find((s) => s.id === review.paper.subjectId);
                            return current
                              ? `currently in ${current.code} — ${current.name}`
                              : review.paper.subjectId
                                ? "currently in a subject this account cannot see"
                                : "not placed into any subject yet";
                          })()}
                        </span>
                        <div className="min-w-52">
                          <Select value={placeSubjectId ?? ""} onValueChange={setPlaceSubjectId}>
                            <SelectTrigger size="sm" aria-label="Target subject">
                              <SelectValue placeholder="Target subject…" />
                            </SelectTrigger>
                            <SelectContent>
                              {subjects.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.code} — {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null || !placeSubjectId}
                          onClick={() => act("paper-place", null)}
                        >
                          {busy === "paper-place" ? "Placing…" : "Place into subject"}
                        </Button>
                      </div>

                      <FindingsPanel paperId={p.id} />
                      <AuditPanel paperId={p.id} />

                      {review.versions.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          This paper has no question versions (empty import).
                        </p>
                      )}
                      <div className="space-y-2">
                        {review.versions.map((v) => (
                          <VersionReviewCard
                            key={v.versionId}
                            version={v}
                            busy={busy}
                            subjectRootId={
                              subjects.find((s) => s.id === review.paper.subjectId)
                                ?.knowledgeNodeId ?? null
                            }
                            onAction={(a, ver) => act(a, ver)}
                            onTopicMapped={(m) => setNotice(m)}
                          />
                        ))}
                      </div>
                      {review.versions.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                          <Button
                            size="sm"
                            disabled={busy !== null || hasBlockedVersions}
                            title={
                              hasBlockedVersions
                                ? "Resolve REJECTED/FLAGGED versions first"
                                : undefined
                            }
                            onClick={() => act("validate-all", null)}
                          >
                            <ListChecks className="size-4" aria-hidden="true" />
                            {busy === "validate-all"
                              ? "Validating…"
                              : "Validate all → student-servable"}
                          </Button>
                          {forceOffer === review.paper.id && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-orange-800"
                              disabled={busy !== null}
                              onClick={() => act("validate-all", null, true)}
                            >
                              <AlertTriangle className="size-4" aria-hidden="true" />
                              Force past reconciliation warning
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-orange-800"
                            disabled={busy !== null}
                            onClick={() => act("paper-flag", null)}
                          >
                            <Flag className="size-4" aria-hidden="true" />
                            {busy === "paper-flag" ? "Flagging…" : "Flag paper"}
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
                          <span className="text-xs text-muted-foreground">
                            Batch validation refuses papers with REJECTED/FLAGGED versions or
                            unreconciled imports — review those item-by-item.
                          </span>
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
