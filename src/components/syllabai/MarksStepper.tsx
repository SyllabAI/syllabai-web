"use client";

import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

/**
 * The self-mark stepper (ADR-026 reveal-and-self-mark flow): one per part,
 * "tick what you earned" against the revealed scheme. Shared by Practice
 * (session-105 tranche) and the exam-questions browser (session-112) — one
 * implementation so the two surfaces cannot drift.
 */
export function MarksStepper({
  value,
  max,
  onChange,
}: {
  value: number | undefined;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label="self-awarded marks">
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7"
        disabled={value === undefined ? true : value <= 0}
        onClick={() => onChange(Math.max(0, (value ?? 0) - 1))}
        aria-label="fewer marks"
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </Button>
      <span className="min-w-14 text-center text-sm font-semibold tabular-nums">
        {value === undefined ? `0/${max}` : `${value}/${max}`}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7"
        disabled={value !== undefined && value >= max}
        onClick={() => onChange(Math.min(max, (value ?? 0) + 1))}
        aria-label="more marks"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </Button>
    </span>
  );
}
