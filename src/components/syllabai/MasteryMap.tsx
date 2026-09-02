"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowDown, Brain, Network, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import type { LearnerStateView, NodeView, PrerequisiteView, SkillStateView, SubjectView } from "@/lib/types";

const bandColor: Record<string, string> = {
  LOW: "text-rose-600 dark:text-rose-400",
  DEVELOPING: "text-amber-600 dark:text-amber-400",
  SECURE: "text-emerald-600 dark:text-emerald-400",
};

const bandProgressClass: Record<string, string> = {
  LOW: "[&>div]:bg-rose-500",
  DEVELOPING: "[&>div]:bg-amber-500",
  SECURE: "[&>div]:bg-emerald-500",
};

function masteryFor(state: LearnerStateView | null, nodeId: string): SkillStateView | null {
  return state?.skillStates.find((s) => s.nodeId === nodeId) ?? null;
}

function MasteryBar({ state }: { state: SkillStateView | null }) {
  if (!state) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Progress value={0} aria-label="Not practised yet" />
        <span className="w-28 shrink-0 text-right">not practised</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <Progress
        value={Math.round(state.effectiveMastery * 100)}
        className={bandProgressClass[state.band] ?? ""}
        aria-label={`Mastery ${Math.round(state.effectiveMastery * 100)} percent`}
      />
      <span className={`w-28 shrink-0 text-right font-medium ${bandColor[state.band] ?? ""}`}>
        {Math.round(state.effectiveMastery * 100)}% · {state.band.toLowerCase()}
      </span>
    </div>
  );
}

interface TopicNodeProps {
  node: NodeView;
  learnerState: LearnerStateView | null;
  onShowPrerequisites: (node: NodeView) => void;
}

function TopicNode({ node, learnerState, onShowPrerequisites }: TopicNodeProps) {
  const misconceptions = node.children.filter((c) => c.type === "MISCONCEPTION");
  const children = node.children.filter((c) => c.type !== "MISCONCEPTION");
  const state = masteryFor(learnerState, node.id);

  return (
    <AccordionItem value={node.id} className="border rounded-md px-4 mb-2">
      <AccordionTrigger className="py-3 hover:no-underline">
        <div className="flex flex-1 flex-col gap-2 pr-4 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{node.title}</span>
            <Badge variant="outline" className="text-[10px]">{node.code}</Badge>
            {state && (
              <Badge variant="secondary" className="text-[10px]">
                {state.correctCount}/{state.attempts} correct
              </Badge>
            )}
          </div>
          <MasteryBar state={state} />
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-2">
        {node.description && (
          <p className="text-xs text-muted-foreground">{node.description}</p>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onShowPrerequisites(node)}
          className="h-7 text-xs"
        >
          <Network className="size-3.5" aria-hidden="true" />
          Prerequisite chain
        </Button>
        {misconceptions.length > 0 && (
          <div className="rounded-md border border-dashed p-2">
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <TriangleAlert className="size-3" aria-hidden="true" />
              Known misconceptions on this node
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              {misconceptions.map((m) => (
                <li key={m.id}>{m.title}</li>
              ))}
            </ul>
          </div>
        )}
        {children.length > 0 && (
          <div className="space-y-1 pl-2">
            {children.map((child) => (
              <div key={child.id} className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{child.title}</span>
                    <Badge variant="outline" className="text-[10px]">{child.code}</Badge>
                  </div>
                  <MasteryBar state={masteryFor(learnerState, child.id)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

export function MasteryMap({ learnerState }: { learnerState: LearnerStateView | null }) {
  const [subject, setSubject] = useState<SubjectView | null>(null);
  const [tree, setTree] = useState<NodeView | null>(null);
  const [prereqNode, setPrereqNode] = useState<NodeView | null>(null);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const subjects = await api.subjects();
        const chemistry = subjects.find((s) => s.knowledgeNodeId) ?? subjects[0] ?? null;
        if (!cancelled && chemistry?.knowledgeNodeId) {
          setSubject(chemistry);
          setTree(await api.knowledgeTree(chemistry.knowledgeNodeId, true));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load the knowledge graph");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showPrerequisites = useCallback(async (node: NodeView) => {
    setPrereqNode(node);
    setPrerequisites(null);
    try {
      setPrerequisites(await api.prerequisites(node.id));
    } catch {
      setPrerequisites([]);
    }
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Knowledge graph unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!tree) {
    return (
      <Alert>
        <AlertTitle>No curriculum seeded</AlertTitle>
        <AlertDescription>
          No subject has a linked knowledge-graph root yet — run the Flyway seed migrations.
        </AlertDescription>
      </Alert>
    );
  }

  const units = tree.children;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="size-4 text-primary" aria-hidden="true" />
            {subject?.name ?? tree.title} — mastery map
          </CardTitle>
          <CardDescription>
            Bars show effective mastery (BKT estimate after forgetting decay since last
            practice). Practise a topic to refresh it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Accordion type="multiple" className="space-y-2">
            {units.map((unit) => (
              <AccordionItem key={unit.id} value={unit.id} className="border rounded-md px-4">
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="flex flex-1 items-center gap-2 text-left">
                    <span className="text-sm font-semibold">{unit.title}</span>
                    <Badge variant="outline" className="text-[10px]">{unit.code}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-3">
                  <Accordion type="multiple" className="m-0 space-y-2">
                    {unit.children
                      .filter((t) => t.type === "TOPIC")
                      .map((topic) => (
                        <TopicNode
                          key={topic.id}
                          node={topic}
                          learnerState={learnerState}
                          onShowPrerequisites={showPrerequisites}
                        />
                      ))}
                  </Accordion>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {prereqNode && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="size-4 text-primary" aria-hidden="true" />
              Prerequisites of {prereqNode.title}
            </CardTitle>
            <CardDescription>
              The remediation path — deepest prerequisite first (Paper A type-1a prerequisite gaps).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {prerequisites === null ? (
              <Skeleton className="h-16 w-full" />
            ) : prerequisites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No prerequisites recorded for this node.
              </p>
            ) : (
              <ol className="space-y-2">
                {prerequisites.map((p, index) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                      {p.depth}
                    </span>
                    {index > 0 && <ArrowDown className="size-3 text-muted-foreground sr-only" aria-hidden="true" />}
                    <div className="flex-1 rounded-md border bg-muted/30 px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{p.title}</span>
                        <Badge variant="outline" className="text-[10px]">{p.code}</Badge>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => {
                setPrereqNode(null);
                setPrerequisites(null);
              }}
            >
              Close
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
