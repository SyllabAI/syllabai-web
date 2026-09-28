"use client";

/**
 * Specification explorer client — topic → sub-topic → statement tree with
 * paper / unit / tier chips, filterable exactly along the printed assessment
 * structure. The chip values ARE the canonical applicability object (T-KG-16)
 * — nothing is derived client-side; the only presentation rule is cosmetic
 * (short codes like "1C" read as "Paper 1C", "U1" as "Unit 1").
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Filter, GraduationCap, Layers, ListChecks, Lock } from "lucide-react";
import type { SpecApplicability } from "@/lib/contracts";

export interface SpecPointVM {
  code: string;
  text: string;
  applicability: SpecApplicability | null;
}

export interface SpecSubtopicVM {
  code: string;
  label: string;
  title: string;
  points: SpecPointVM[];
}

export interface SpecTopicVM {
  number: number;
  title: string;
  subtopics: SpecSubtopicVM[];
}

interface Option {
  value: string;
  label: string;
}

interface Props {
  topics: SpecTopicVM[];
  totalPoints: number;
}

/** "1C" → "Paper 1C"; "4MA1/1F" passes through verbatim. */
function paperLabel(p: string): string {
  return p.length <= 4 ? `Paper ${p}` : p;
}

/** "U1" → "Unit 1"; "U1F" → "Unit 1 (Foundation)"; others verbatim. */
function unitLabel(u: string): string {
  const m = /^U(\d+)([FH])?$/.exec(u);
  if (!m) return u;
  const tier = m[2] === "F" ? " (Foundation)" : m[2] === "H" ? " (Higher)" : "";
  return `Unit ${m[1]}${tier}`;
}

const ALL = "__all__";

function chipsFor(app: SpecApplicability): string[] {
  const chips: string[] = [];
  for (const p of app.papers ?? []) chips.push(paperLabel(p));
  if (app.unit_scope) chips.push(unitLabel(app.unit_scope));
  if (app.tier) chips.push(app.tier);
  if (app.coursework) chips.push("Coursework (internally assessed)");
  if (app.double_award_shared) chips.push("Also in Double Award");
  return chips;
}

function matches(app: SpecApplicability | null, paper: string, unit: string, tier: string): boolean {
  if (paper === ALL && unit === ALL && tier === ALL) return true;
  if (!app) return false;
  if (paper !== ALL && !(app.papers ?? []).includes(paper)) return false;
  if (unit !== ALL && app.unit_scope !== unit) return false;
  if (tier !== ALL && app.tier !== tier) return false;
  return true;
}

export function SpecificationExplorer({ topics, totalPoints }: Props) {
  const [paper, setPaper] = useState(ALL);
  const [unit, setUnit] = useState(ALL);
  const [tier, setTier] = useState(ALL);

  const filterActive = paper !== ALL || unit !== ALL || tier !== ALL;

  const { paperOptions, unitOptions, tierOptions, chipsSeen } = useMemo(() => {
    const papers = new Map<string, string>();
    const units = new Map<string, string>();
    const tiers = new Map<string, string>();
    let chips = 0;
    for (const t of topics)
      for (const s of t.subtopics)
        for (const p of s.points) {
          const a = p.applicability;
          if (!a) continue;
          chips += 1;
          for (const x of a.papers ?? []) papers.set(x, paperLabel(x));
          if (a.unit_scope) units.set(a.unit_scope, unitLabel(a.unit_scope));
          if (a.tier) tiers.set(a.tier, a.tier);
        }
    const sortEntries = (m: Map<string, string>): Option[] =>
      [...m.entries()]
        .sort((x, y) => x[1].localeCompare(y[1], undefined, { numeric: true }))
        .map(([value, label]) => ({ value, label }));
    return {
      paperOptions: sortEntries(papers),
      unitOptions: sortEntries(units),
      tierOptions: sortEntries(tiers),
      chipsSeen: chips,
    };
  }, [topics]);

  const visible = useMemo(() => {
    let n = 0;
    for (const t of topics)
      for (const s of t.subtopics)
        for (const p of s.points) if (matches(p.applicability, paper, unit, tier)) n += 1;
    return n;
  }, [topics, paper, unit, tier]);

  /** A dimension with exactly one value in this qualification — nothing to
   *  filter, so render it as a locked fact instead of an interactive select. */
  const renderLocked = (
    key: string,
    icon: React.ReactNode,
    labelText: string,
    value: string,
  ) => (
    <div key={key} className="flex flex-col gap-1.5">
      <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {labelText}
      </Label>
      <div className="flex h-9 items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground">
        <Lock className="size-3.5 shrink-0" aria-hidden />
        <span>Every statement · {value}</span>
      </div>
    </div>
  );

  const renderSelect = (
    id: string,
    icon: React.ReactNode,
    labelText: string,
    value: string,
    onChange: (v: string) => void,
    options: Option[],
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {labelText}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9 w-full min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      {chipsSeen === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Paper/unit applicability has not been derived for this course yet — the
            statements below are the parsed specification, verbatim.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Filter className="size-4 text-muted-foreground" aria-hidden />
                Scope the specification
              </CardTitle>
              <Badge variant="outline" className="font-mono text-[10px]">
                {filterActive ? `${visible} / ${totalPoints}` : totalPoints} spec points
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {paperOptions.length >= 2 &&
              renderSelect("flt-paper", <ListChecks className="size-3.5" aria-hidden />, "Paper", paper, setPaper, paperOptions)}
            {paperOptions.length === 1 &&
              renderLocked("lk-paper", <ListChecks className="size-3.5" aria-hidden />, "Paper", paperLabel(paperOptions[0].value))}
            {unitOptions.length >= 2 &&
              renderSelect("flt-unit", <Layers className="size-3.5" aria-hidden />, "Unit", unit, setUnit, unitOptions)}
            {unitOptions.length === 1 &&
              renderLocked("lk-unit", <Layers className="size-3.5" aria-hidden />, "Unit", unitLabel(unitOptions[0].value))}
            {tierOptions.length >= 2 &&
              renderSelect("flt-tier", <GraduationCap className="size-3.5" aria-hidden />, "Tier", tier, setTier, tierOptions)}
            {tierOptions.length === 1 &&
              renderLocked("lk-tier", <GraduationCap className="size-3.5" aria-hidden />, "Tier", tierOptions[0].value)}
            <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-3">
              Assessment homes come from the parsed Pearson specification (content
              summaries &amp; assessment overviews). Hover a chip for the printed rule.
              Filters appear only where the qualification has that structure — a
              linear IGCSE has no unit scope, and only Maths A splits Foundation /
              Higher tiers.
            </p>
          </CardContent>
        </Card>
      )}

      {topics.map((t) => {
        const topicRows = t.subtopics.reduce(
          (acc, s) => acc + s.points.filter((p) => matches(p.applicability, paper, unit, tier)).length,
          0,
        );
        if (filterActive && topicRows === 0) return null;
        return (
          <Card key={`${t.number}-${t.title}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t.number}. {t.title}
                {filterActive && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {topicRows} shown
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {t.subtopics.map((s) => {
                const rows = s.points.filter((p) => matches(p.applicability, paper, unit, tier));
                if (rows.length === 0) return null;
                return (
                  <div key={s.code}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.label}. {s.title}
                    </p>
                    <ul className="space-y-1.5">
                      {rows.map((p) => {
                        const chips = p.applicability ? chipsFor(p.applicability) : [];
                        return (
                          <li
                            key={p.code}
                            className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-muted/50 sm:flex-row sm:items-start sm:gap-3"
                          >
                            <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                              {p.code}
                            </Badge>
                            <span className="min-w-0 flex-1 text-sm leading-relaxed">{p.text}</span>
                            {chips.length > 0 && (
                              <span
                                className="flex shrink-0 flex-wrap gap-1"
                                title={p.applicability?.rule ?? undefined}
                              >
                                {chips.map((c) => (
                                  <Badge
                                    key={c}
                                    variant="secondary"
                                    className="cursor-help text-[10px]"
                                  >
                                    {c}
                                  </Badge>
                                ))}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}

      {filterActive && visible === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No specification statements match this scope combination.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
