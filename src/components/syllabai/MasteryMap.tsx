"use client";

/**
 * T-028 mastery map: the curriculum tree + the 2D graph visualiser over ONE
 * personalized payload (F-034 GET /api/v1/learners/me/knowledge-graph) —
 * the client-side tree + /state join is retired. The tree view is the
 * accessible default; the graph view (F-036) adds the spatial overview with
 * prerequisite edges.
 */
import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ArrowDown, Brain, ListTree, Network, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { KnowledgeGraphView } from "@/components/syllabai/KnowledgeGraphView";
import type {
  LearnerKnowledgeGraphView,
  LearnerNodeWithStateView,
  PrerequisiteView,
} from "@/lib/types";

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

function MasteryBar({ node }: { node: LearnerNodeWithStateView }) {
  if (node.effectiveMastery === null || node.band === null) {
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
        value={Math.round(node.effectiveMastery * 100)}
        className={bandProgressClass[node.band] ?? ""}
        aria-label={`Mastery ${Math.round(node.effectiveMastery * 100)} percent`}
      />
      <span className={`w-28 shrink-0 text-right font-medium ${bandColor[node.band] ?? ""}`}>
        {Math.round(node.effectiveMastery * 100)}% · {node.band.toLowerCase()}
      </span>
    </div>
  );
}

function MisconceptionList({ misconceptions }: { misconceptions: LearnerNodeWithStateView[] }) {
  if (misconceptions.length === 0) return null;
  return (
    <div className="rounded-md border border-dashed p-2">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <TriangleAlert className="size-3" aria-hidden="true" />
        Known misconceptions on this node
      </p>
      <ul className="list-inside list-disc space-y-0.5 text-xs">
        {misconceptions.map((m) => (
          <li key={m.id}>
            {m.title}
            {m.misconceptionActive === true && (
              <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
                (active {Math.round((m.misconceptionProbability ?? 0) * 100)}%)
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface NestedNode extends LearnerNodeWithStateView {
  children: NestedNode[];
}

function nest(
  id: string,
  byId: Map<string, LearnerNodeWithStateView>,
): NestedNode | null {
  const node = byId.get(id);
  if (!node) return null;
  const children = node.childIds
    .map((cid) => nest(cid, byId))
    .filter((c): c is NestedNode => c !== null);
  return { ...node, children };
}

function TopicNode({
  node,
  onShowPrerequisites,
  onPracticeTopic,
}: {
  node: NestedNode;
  onShowPrerequisites: (node: NestedNode) => void;
  onPracticeTopic: (nodeId: string, title: string) => void;
}) {
  const misconceptions = node.children.filter((c) => c.type === "MISCONCEPTION");
  const children = node.children.filter((c) => c.type !== "MISCONCEPTION");

  return (
    <AccordionItem value={node.id} className="border rounded-md px-4 mb-2">
      <AccordionTrigger className="py-3 hover:no-underline">
        <div className="flex flex-1 flex-col gap-2 pr-4 text-left">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{node.title}</span>
            <Badge variant="outline" className="text-[10px]">{node.code}</Badge>
            {node.attempts !== null && (
              <Badge variant="secondary" className="text-[10px]">
                {node.correctCount}/{node.attempts} correct
              </Badge>
            )}
            {node.reviewDueAt && (
              <Badge className="bg-amber-500 hover:bg-amber-500 text-[10px]">review due</Badge>
            )}
          </div>
          <MasteryBar node={node} />
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-2">
        {node.description && (
          <p className="text-xs text-muted-foreground">{node.description}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onShowPrerequisites(node)}
            className="h-7 text-xs"
          >
            <Network className="size-3.5" aria-hidden="true" />
            Prerequisite chain
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPracticeTopic(node.id, node.title)}
            className="h-7 text-xs"
          >
            Practise this topic
          </Button>
        </div>
        <MisconceptionList misconceptions={misconceptions} />
        {children.length > 0 && (
          <div className="space-y-1 pl-2">
            {children.map((child) => (
              <div key={child.id} className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{child.title}</span>
                    <Badge variant="outline" className="text-[10px]">{child.code}</Badge>
                  </div>
                  <MasteryBar node={child} />
                  <MisconceptionList
                    misconceptions={child.children.filter((c) => c.type === "MISCONCEPTION")}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function PrerequisiteChainCard({
  node,
  prerequisites,
  onClose,
}: {
  node: LearnerNodeWithStateView;
  prerequisites: PrerequisiteView[] | null;
  onClose: () => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="size-4 text-primary" aria-hidden="true" />
          Prerequisites of {node.title}
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
        <Button variant="ghost" size="sm" className="mt-3" onClick={onClose}>
          Close
        </Button>
      </CardContent>
    </Card>
  );
}

function NodeDetailCard({
  node,
  byId,
  onPracticeTopic,
}: {
  node: LearnerNodeWithStateView;
  byId: Map<string, LearnerNodeWithStateView>;
  onPracticeTopic: (nodeId: string, title: string) => void;
}) {
  const [prerequisites, setPrerequisites] = useState<PrerequisiteView[] | null>(null);
  const misconceptions = node.childIds
    .map((cid) => byId.get(cid))
    .filter((c): c is LearnerNodeWithStateView => c?.type === "MISCONCEPTION");

  const loadChain = useCallback(async () => {
    setPrerequisites(null);
    try {
      setPrerequisites(await api.prerequisites(node.id));
    } catch {
      setPrerequisites([]);
    }
  }, [node.id]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {node.title}
          <Badge variant="outline" className="text-[10px]">{node.code}</Badge>
          <Badge variant="secondary" className="text-[10px]">{node.type.toLowerCase()}</Badge>
          {node.reviewDueAt && (
            <Badge className="bg-amber-500 hover:bg-amber-500 text-[10px]">review due</Badge>
          )}
        </CardTitle>
        {node.description && <CardDescription>{node.description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <MasteryBar node={node} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {node.attempts !== null && <span>{node.correctCount}/{node.attempts} correct</span>}
          {node.lastPracticedAt && <span>practised {formatRelative(node.lastPracticedAt)}</span>}
          {node.proceduralFluencyGap != null && (
            <span title="Untimed accuracy minus timed accuracy (Paper B §16 fluency gap)">
              fluency gap Δ{node.proceduralFluencyGap >= 0 ? "+" : ""}
              {node.proceduralFluencyGap.toFixed(2)}
            </span>
          )}
          {node.reviewDueAt && (
            <span>review: {node.reviewReason?.toLowerCase().replace(/_/g, " ")}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(node.type === "TOPIC" || node.type === "SUBTOPIC") && (
            <Button size="sm" onClick={() => onPracticeTopic(node.id, node.title)} className="h-8 text-xs">
              Practise this topic
            </Button>
          )}
          {prerequisites === null && (
            <Button variant="outline" size="sm" onClick={loadChain} className="h-8 text-xs">
              <Network className="size-3.5" aria-hidden="true" />
              Prerequisite chain
            </Button>
          )}
        </div>
        {prerequisites !== null && (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Prerequisite chain (deepest first)
            </p>
            {prerequisites.length === 0 ? (
              <p className="text-xs text-muted-foreground">No prerequisites recorded.</p>
            ) : (
              <ol className="space-y-1">
                {prerequisites.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-xs">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold">
                      {p.depth}
                    </span>
                    <span>{p.title}</span>
                    <Badge variant="outline" className="text-[10px]">{p.code}</Badge>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        <MisconceptionList misconceptions={misconceptions} />
      </CardContent>
    </Card>
  );
}

export function MasteryMap({
  graph,
  loading,
  subjectName,
  onPracticeTopic,
}: {
  graph: LearnerKnowledgeGraphView | null;
  loading: boolean;
  subjectName: string | null;
  onPracticeTopic: (nodeId: string, title: string) => void;
}) {
  const [mode, setMode] = useState<"tree" | "graph">("tree");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chainNode, setChainNode] = useState<NestedNode | null>(null);
  const [chain, setChain] = useState<PrerequisiteView[] | null>(null);

  const byId = useMemo(
    () => new Map((graph?.nodes ?? []).map((n) => [n.id, n])),
    [graph],
  );
  const root = useMemo(
    () => (graph ? nest(graph.rootId, byId) : null),
    [graph, byId],
  );
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  // load the prerequisite chain on demand (same endpoint as before)
  const showPrerequisites = useCallback(async (node: NestedNode) => {
    setChainNode(node);
    setChain(null);
    try {
      setChain(await api.prerequisites(node.id));
    } catch {
      setChain([]);
    }
  }, []);

  if (loading && !graph) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (!graph || !root) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Knowledge graph unavailable</AlertTitle>
        <AlertDescription>
          The personalized graph could not be loaded — try again in a moment.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="size-4 text-primary" aria-hidden="true" />
                {subjectName ?? graph.rootTitle} — mastery map
              </CardTitle>
              <CardDescription>
                Bars show effective mastery (BKT estimate after forgetting decay since last
                practice). Practise a topic to refresh it.
              </CardDescription>
            </div>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as "tree" | "graph")}
              aria-label="Mastery map view"
            >
              <ToggleGroupItem value="tree" className="gap-1.5 text-xs">
                <ListTree className="size-3.5" aria-hidden="true" />
                Tree
              </ToggleGroupItem>
              <ToggleGroupItem value="graph" className="gap-1.5 text-xs">
                <Network className="size-3.5" aria-hidden="true" />
                Graph
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {mode === "tree" ? (
            <Accordion type="multiple" className="space-y-2">
              {root.children.map((unit) => (
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
                            onShowPrerequisites={showPrerequisites}
                            onPracticeTopic={onPracticeTopic}
                          />
                        ))}
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : (
            <KnowledgeGraphView
              nodes={graph.nodes}
              rootId={graph.rootId}
              prerequisiteEdges={graph.prerequisiteEdges}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </CardContent>
      </Card>

      {mode === "graph" && selected && (
        <NodeDetailCard node={selected} byId={byId} onPracticeTopic={onPracticeTopic} />
      )}

      {mode === "tree" && chainNode && (
        <PrerequisiteChainCard
          node={chainNode}
          prerequisites={chain}
          onClose={() => {
            setChainNode(null);
            setChain(null);
          }}
        />
      )}
    </div>
  );
}
