"use client";

/**
 * Attempt history — the Review Hub minimal slice (charter §14). A read-only
 * view over the learner's own immutable attempt/answer evidence: what was
 * answered, how it was marked, and where it happened. Facts only — no advice
 * (advice lives in the next-best-actions card), no re-derived mastery.
 *
 * Honesty rules pinned server-side and mirrored here: structured attempts
 * awaiting marking show "awaiting marks" (never a guess), and marks/labels
 * appear exactly when an authoritative mark exists.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  HelpCircle,
  Hourglass,
  RotateCcw,
  Timer,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { AttemptHistoryItem, AttemptHistoryView } from "@/lib/types";

const MARKING_STATE_LABELS: Record<string, string> = {
  AUTO_GRADED: "auto-graded",
  PENDING: "awaiting marks",
  SMART_MARKED: "smart-marked",
  HUMAN_MARKED: "teacher-marked",
  OVERRIDDEN: "teacher override",
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const days = Math.floor((now - date.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (days <= 0) return `today, ${time}`;
  if (days === 1) return `yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function OutcomeBadge({ item }: { item: AttemptHistoryItem }) {
  if (item.correct === null) {
    // Structured attempts carry no pass/fail classification by design (a
    // 1/2-mark answer is neither correct nor incorrect) — only a genuinely
    // PENDING attempt "awaits marks". Once marks exist, the marks total and
    // the marking-state chip below carry the facts; a pass/fail badge here
    // would fabricate a classification the backend deliberately withholds.
    if (item.markingState === "PENDING") {
      return (
        <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400">
          <Hourglass className="size-3" aria-hidden="true" />
          awaiting marks
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1 border-slate-500/40 text-slate-600 dark:text-slate-300">
        <ClipboardList className="size-3" aria-hidden="true" />
        marked
      </Badge>
    );
  }
  return item.correct ? (
    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="size-3" aria-hidden="true" />
      correct
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 border-rose-500/40 text-rose-700 dark:text-rose-400">
      <XCircle className="size-3" aria-hidden="true" />
      not correct
    </Badge>
  );
}

function AttemptCard({
  item,
  onPracticeTopic,
}: {
  item: AttemptHistoryItem;
  onPracticeTopic: (nodeId: string, title: string) => void;
}) {
  const isStructured = item.questionType === "STRUCTURED";
  const markingLabel = MARKING_STATE_LABELS[item.markingState] ?? item.markingState.toLowerCase();
  const topicTitle = item.topicTitle ?? item.topicCode;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <OutcomeBadge item={item} />
              <CardTitle className="text-sm font-medium">
                {item.commandWord ?? "Question"}
                {" · "}
                {item.marksAwarded === null
                  ? `${item.marksTotal} mark${item.marksTotal > 1 ? "s" : ""}`
                  : `${item.marksAwarded}/${item.marksTotal} mark${item.marksTotal > 1 ? "s" : ""}`}
              </CardTitle>
              {isStructured && (
                <Badge variant="secondary" className="text-[10px] font-normal">
                  written
                </Badge>
              )}
            </div>
            <CardDescription className="mt-1">
              {formatWhen(item.attemptedAt)}
              {item.externalRef ? ` · ${item.externalRef}` : ""}
              {topicTitle ? ` · ${topicTitle}` : ""}
            </CardDescription>
          </div>
          {topicTitle && item.topicNodeId && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => onPracticeTopic(item.topicNodeId, topicTitle)}
              title="Practise this topic again"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Practise topic
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm leading-relaxed text-foreground/90">{item.stemExcerpt}</p>

        {item.chosenOptionLabel && (
          <p className="text-xs text-muted-foreground">
            You chose <span className="font-semibold text-foreground/80">{item.chosenOptionLabel}</span>
            {item.correctOptionLabel && !item.correct ? (
              <>
                {" — correct answer was "}
                <span className="font-semibold text-foreground/80">{item.correctOptionLabel}</span>
              </>
            ) : null}
          </p>
        )}

        {item.implicatedMisconceptionIds.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
            Matched a documented misconception — see the tutor for the underlying idea.
          </p>
        )}

        {isStructured && item.parts.length > 0 && (
          <ul className="space-y-1">
            {item.parts.map((part) => (
              <li
                key={part.partId}
                className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              >
                <span>Part {part.label}</span>
                <span>
                  {part.marksAwarded === null
                    ? "awaiting marks"
                    : `${part.marksAwarded}/${part.marksPossible}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" aria-hidden="true" />
            {formatDuration(item.responseTimeMs)}
          </span>
          {item.timedCondition && (
            <span className="flex items-center gap-1">
              <Timer className="size-3" aria-hidden="true" />
              timed
            </span>
          )}
          {item.selfDoubtFlag && <span>self-doubt flagged</span>}
          {item.confidenceLevel != null && <span>confidence {item.confidenceLevel}/5</span>}
          <span>{markingLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function HistoryView({
  history,
  loading,
  error,
  onPracticeTopic,
}: {
  history: AttemptHistoryView | null;
  loading: boolean;
  error: string | null;
  onPracticeTopic: (nodeId: string, title: string) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4 text-primary" aria-hidden="true" />
            My learning history
          </CardTitle>
          <CardDescription>
            Every attempt you have made — answers, marks and marking state, straight from
            your recorded evidence. Retry a topic whenever you are ready.
          </CardDescription>
        </CardHeader>
        {history && history.total > history.returned && (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Showing your {history.returned} most recent attempts of {history.total} in total.
            </p>
          </CardContent>
        )}
      </Card>

      {loading && !history ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex items-start gap-2 pt-6 text-sm text-muted-foreground">
            <HelpCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              History is unavailable right now ({error}). Your attempts are still safely
              recorded — try refreshing.
            </p>
          </CardContent>
        </Card>
      ) : !history || history.attempts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <ClipboardList className="size-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="max-w-sm text-sm text-muted-foreground">
              No attempts yet — the learning loop starts with your first question. Every
              attempt you make will appear here with its marks and feedback.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {history.attempts.map((item) => (
            <AttemptCard key={item.attemptId} item={item} onPracticeTopic={onPracticeTopic} />
          ))}
        </div>
      )}
    </div>
  );
}
