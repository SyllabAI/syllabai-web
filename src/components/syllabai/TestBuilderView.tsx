"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ClipboardList,
  FileText,
  Printer,
} from "lucide-react";
import { api } from "@/lib/api";
import type { NodeView, SubjectView, TestPreviewView } from "@/lib/types";

/**
 * P9 Test Builder (smallest useful version): pick a subject and curriculum
 * topics, assemble a printable test from VALIDATED content only (the backend
 * reuses the learner-serving boundary — unvalidated content can never enter a
 * generated test), optionally with the mark-scheme answer key. Print via the
 * browser (print CSS hides the app chrome).
 */
export function TestBuilderView({
  subjects,
  selectedRootId,
}: {
  subjects: SubjectView[];
  selectedRootId: string | null;
}) {
  const [rootId, setRootId] = useState<string | null>(selectedRootId);
  const [tree, setTree] = useState<NodeView | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxQuestions, setMaxQuestions] = useState(20);
  const [targetMarks, setTargetMarks] = useState<number | null>(null);
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [preview, setPreview] = useState<TestPreviewView | null>(null);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(true);

  useEffect(() => {
    if (!selectedRootId) return;
    setRootId((current) => current ?? selectedRootId);
  }, [selectedRootId]);

  useEffect(() => {
    if (!rootId) return;
    let cancelled = false;
    setTreeLoading(true);
    setTreeError(null);
    setTree(null);
    setSelected(new Set());
    setPreview(null);
    (async () => {
      try {
        const t = await api.knowledgeTree(rootId, false);
        if (!cancelled) setTree(t);
      } catch (err) {
        if (!cancelled)
          setTreeError(err instanceof Error ? err.message : "Failed to load curriculum tree");
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootId]);

  /** TOPIC + SUBTOPIC nodes are selectable (same rule as the NBA/practice scope) */
  const selectable = useMemo(() => {
    if (!tree) return [];
    const out: { id: string; code: string; title: string; type: string }[] = [];
    const walk = (n: NodeView) => {
      if (n.type === "TOPIC" || n.type === "SUBTOPIC") {
        out.push({ id: n.id, code: n.code, title: n.title, type: n.type });
      }
      n.children.forEach(walk);
    };
    tree.children.forEach(walk);
    return out;
  }, [tree]);

  function toggle(id: string) {
    setPreview(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function build() {
    if (!rootId || selected.size === 0) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const view = await api.testBuilderPreview(
        rootId,
        Array.from(selected),
        targetMarks && targetMarks > 0 ? maxQuestions : undefined,
        targetMarks && targetMarks > 0 ? targetMarks : undefined,
        includeAnswers,
      );
      setPreview(view);
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : "Failed to assemble test");
    } finally {
      setBuilding(false);
    }
  }

  if (subjects.length === 0) {
    return (
      <Alert>
        <AlertTitle>No subjects available</AlertTitle>
        <AlertDescription>The curriculum has not been initialised yet.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4 print:hidden">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="size-4 text-primary" aria-hidden="true" />
            Test Builder
          </CardTitle>
          <CardDescription>
            Assemble a printable topic test from validated questions only —
            suggested, flagged or rejected content never enters a generated test.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="tb-subject">Subject</Label>
              <select
                id="tb-subject"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={rootId ?? ""}
                onChange={(e) => setRootId(e.target.value || null)}
              >
                {subjects
                  .filter((s) => s.knowledgeNodeId)
                  .map((s) => (
                    <option key={s.id} value={s.knowledgeNodeId!}>
                      {s.name} ({s.code})
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tb-max">Max questions</Label>
              <Input
                id="tb-max"
                type="number"
                min={1}
                max={50}
                value={maxQuestions}
                onChange={(e) => {
                  setPreview(null);
                  setMaxQuestions(Number(e.target.value) || 20);
                }}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                ignored when a marks target is set
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tb-marks">Target marks (optional)</Label>
              <Input
                id="tb-marks"
                type="number"
                min={0}
                max={200}
                placeholder="e.g. 40"
                value={targetMarks ?? ""}
                onChange={(e) => {
                  setPreview(null);
                  const v = Number(e.target.value);
                  setTargetMarks(e.target.value === "" || v <= 0 ? null : v);
                }}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                marks-aware assembly: questions fill to the target (deterministic greedy,
                smallest overshoot when exact is impossible)
              </p>
            </div>
            <div className="flex items-end gap-2 pb-0.5">
              <Checkbox
                id="tb-answers"
                checked={includeAnswers}
                onCheckedChange={(v) => {
                  setPreview(null);
                  setIncludeAnswers(v === true);
                }}
              />
              <Label htmlFor="tb-answers" className="text-sm font-normal">
                Include answer key (mark scheme)
              </Label>
            </div>
          </div>

          {treeLoading && <Skeleton className="h-48 w-full" />}
          {treeError && (
            <Alert variant="destructive">
              <AlertDescription>{treeError}</AlertDescription>
            </Alert>
          )}
          {tree && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                {selected.size} of {selectable.length} topics selected
              </p>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-3">
                {selectable.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected.has(t.id)}
                      onCheckedChange={() => toggle(t.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-xs text-muted-foreground">{t.code}</span>{" "}
                      {t.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={build} disabled={building || selected.size === 0}>
              <FileText className="size-4" aria-hidden="true" />
              {building ? "Assembling…" : "Generate test"}
            </Button>
            {preview && (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden="true" />
                Print
              </Button>
            )}
            {preview && includeAnswers && (
              <Button variant="ghost" size="sm" onClick={() => setShowKey((v) => !v)}>
                {showKey ? "Hide answer key" : "Show answer key"}
              </Button>
            )}
          </div>

          {buildError && (
            <Alert variant="destructive">
              <AlertDescription>{buildError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Assembled test</CardTitle>
            <CardDescription>
              {preview.questionCount} question{preview.questionCount === 1 ? "" : "s"} ·{" "}
              {preview.totalMarks} marks
              {preview.targetMarks
                ? ` (target ${preview.targetMarks})`
                : ""}{" "}
              · {preview.topics.length} topic
              {preview.topics.length === 1 ? "" : "s"}
              {preview.topics
                .filter((t) => t.servableQuestions === 0)
                .map((t) => ` · ${t.code}: no validated questions yet`)
                .join("")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {preview.topics.map((t) => (
                  <Badge key={t.topicNodeId} variant="outline">
                    {t.code} · {t.servableQuestions} available
                  </Badge>
                ))}
              </div>
            )}
            {preview.questions.map((q, i) => (
              <div key={q.id} className="rounded-md border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {i + 1}. {q.stem}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ({q.marks} marks · {q.topicCode})
                  </span>
                </div>
                {q.parts.map((p) => (
                  <div key={p.id} className="mt-2 pl-4 text-sm">
                    <span className="font-medium">({p.label})</span> {p.prompt}{" "}
                    <span className="text-xs text-muted-foreground">[{p.marks}]</span>
                  </div>
                ))}
                {q.options.length > 0 && (
                  <ul className="mt-2 list-disc pl-8 text-sm">
                    {q.options.map((o) => (
                      <li key={o.id}>
                        <span className="font-medium">{o.label})</span> {o.text}
                      </li>
                    ))}
                  </ul>
                )}
                {showKey && q.answers.length > 0 && (
                  <details className="mt-2 rounded bg-muted/40 p-2">
                    <summary className="cursor-pointer text-xs font-medium">
                      Answer key {q.schemeState && `(scheme: ${q.schemeState})`}
                    </summary>
                    <ul className="mt-1 space-y-1 pl-4 text-xs">
                      {q.answers.map((a, j) => (
                        <li key={j}>
                          <span className="font-mono">{a.partLabel ?? ""} {a.ref ?? ""}</span>{" "}
                          {a.text} <span className="text-muted-foreground">[{a.marks}]</span>
                          {a.acceptanceCriteria.length > 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              — accept: {a.acceptanceCriteria.join("; ")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
