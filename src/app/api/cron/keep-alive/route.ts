// Keep-alive ping for the NightlyDecayJob window (session-109 finding).
//
// Render's free tier suspends the core service after ~15 min without inbound
// traffic, and the nightly forgetting-decay batch (syllabai.learner.decay-job,
// cron "0 0 3 * * *", prod profile) only fires if the JVM is up at 03:00 UTC.
// Measured 2026-09-20: the Sept 17-20 03:00 runs never fired — the instance
// was suspended straight through the window (8.22 h telemetry quiet-gap; the
// Sept 16 run only fired because CLA-eval traffic happened to keep the
// instance up that night). Missed runs self-heal mathematically (the next
// awake run recomputes from the same last_practiced_at anchors with the full
// elapsed delta), but the pilot's t1 measurement needs the schedule to be
// *reliably* nightly.
//
// vercel.json schedules this route once daily at 02:50 UTC: the request wakes
// the service (observed cold starts 105-175 s), the instance then stays up
// ~15 min past the last inbound request — comfortably covering the 03:00
// fire — and the decay job runs on schedule. GitHub Actions was rejected for
// this (org quota exhausted 2026-09-15, CI_COST_AUDIT_2026-09-16; scheduled
// runs also show multi-hour queue delays).
//
// Deliberately unauthenticated: this route only GETs the public health
// endpoint — no state, no credentials, no side effects beyond waking the
// instance. If a CRON_SECRET is ever set on the Vercel project, add a bearer
// check here.
//
// Timeout note: Hobby serverless functions cap at 60 s and Render cold starts
// can reach ~175 s. The outbound request still reaches Render and wakes it
// even when this function gives up waiting — a timeout response here is
// therefore NOT a failure of the keep-alive purpose.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORE_HEALTH_URL = "https://syllabai-core.onrender.com/actuator/health";

export async function GET() {
  const startedAt = Date.now();
  try {
    const response = await fetch(CORE_HEALTH_URL, {
      cache: "no-store",
      // 55 s: headroom inside the 60 s function budget
      signal: AbortSignal.timeout(55_000),
    });
    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      ok: null,
      status: "timeout_or_error",
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
      note: "request still sent — instance wake likely succeeded",
      error: error instanceof Error ? error.name : String(error),
    });
  }
}
