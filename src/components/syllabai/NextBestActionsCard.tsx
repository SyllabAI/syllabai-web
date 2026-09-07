"use client";

/**
 * T-033: the learner-facing "Next best actions" card (F-092 minimal slice,
 * ADR-017). This is RECOMMENDATION output — ranked learning advice derived from
 * the learner's measured evidence — deliberately distinct from the dashboard's
 * measured-fact cards (architecture rule: keep recommendation output separate
 * from measured learner facts). Every reason line is the backend's structured,
 * evidence-derived reasonDetail: the UI never invents or rewords the evidence.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarClock,
  Compass,
  HelpCircle,
  Layers,
  Link2,
  MessagesSquare,
  RotateCcw,
  Target,
  Timer,
} from "lucide-react";
import { humanizeCode } from "@/lib/format";
import type { NextBestActionView, NextBestActionsView, NextBestActionType } from "@/lib/types";

const typeConfig: Record<
  NextBestActionType,
  { label: string; icon: typeof Compass; chip: string }
> = {
  REVIEW_TOPIC: {
    label: "Review topic",
    icon: CalendarClock,
    chip: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  },
  PRACTISE_QUESTIONS: {
    label: "Practise questions",
    icon: Target,
    chip: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  },
  REVIEW_PREREQUISITE: {
    label: "Review prerequisite",
    icon: Link2,
    chip: "border-violet-500/40 text-violet-700 dark:text-violet-400",
  },
  RETRY_PROBLEM_QUESTION: {
    label: "Retry question",
    icon: RotateCcw,
    chip: "border-rose-500/40 text-rose-700 dark:text-rose-400",
  },
  ASK_TUTOR: {
    label: "Ask Tutor",
    icon: MessagesSquare,
    chip: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  },
  TIMED_EXERCISE: {
    label: "Timed exercise",
    icon: Timer,
    chip: "border-orange-500/40 text-orange-700 dark:text-orange-400",
  },
};

function ActionRow({
  action,
  onPracticeTopic,
  onAskTutor,
}: {
  action: NextBestActionView;
  onPracticeTopic: (nodeId: string, title: string) => void;
  onAskTutor: () => void;
}) {
  const config = typeConfig[action.actionType];
  const Icon = config.icon;
  const isPracticeAction =
    action.actionType !== "ASK_TUTOR" && action.servableQuestionCount > 0;
  const noQuestions =
    action.actionType !== "ASK_TUTOR" && action.servableQuestionCount === 0;

  return (
    <li
      className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
      aria-label={`Action ${action.rank}: ${config.label} — ${action.targetTitle}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums text-muted-foreground">
          {action.rank}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`${config.chip} h-5 gap-1 px-1.5 text-[11px]`}>
              <Icon className="size-3" aria-hidden="true" />
              {config.label}
            </Badge>
            <p className="truncate text-sm font-medium">{action.targetTitle}</p>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {action.reasonDetail}
          </p>
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        {action.actionType === "ASK_TUTOR" ? (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAskTutor}>
            Ask Tutor
          </Button>
        ) : noQuestions ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" title="No validated questions are mapped to this topic yet">
            <HelpCircle className="size-3" aria-hidden="true" />
            none yet
          </span>
        ) : isPracticeAction ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onPracticeTopic(action.targetNodeId, action.targetTitle)}
          >
            {action.actionType === "RETRY_PROBLEM_QUESTION"
              ? "Retry now"
              : action.actionType === "TIMED_EXERCISE"
                ? "Practise timed"
                : "Practise"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function NextBestActionsCard({
  view,
  loading,
  error,
  onPracticeTopic,
  onAskTutor,
}: {
  view: NextBestActionsView | null;
  loading: boolean;
  error: string | null;
  onPracticeTopic: (nodeId: string, title: string) => void;
  onAskTutor: () => void;
}) {
  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Compass className="size-4 text-primary" aria-hidden="true" />
          Next best actions
        </CardTitle>
        <CardDescription>
          Ranked learning advice from your evidence — what to do next and why. Reasons
          cite measured marks, mastery and schedules; they are advice, not facts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !view ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Next-best actions are unavailable right now — the measured panels below
            still work.
          </p>
        ) : !view || view.actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to recommend yet — answer a question and the learning loop starts
            here.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {view.actions.map((action) => (
                <ActionRow
                  key={`${action.rank}-${action.targetNodeId}-${action.questionId ?? ""}`}
                  action={action}
                  onPracticeTopic={onPracticeTopic}
                  onAskTutor={onAskTutor}
                />
              ))}
            </ul>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Layers className="size-3 shrink-0" aria-hidden="true" />
              {view.policy} · deterministic rule baseline · reason codes:{" "}
              {view.actions.map((a) => humanizeCode(a.reasonCode)).slice(0, 3).join(", ")}
              {view.actions.length > 3 ? ", …" : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
