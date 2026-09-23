// Keep-alive ping for the NightlyDecayJob window (session-109 finding;
// rescheduled session-122 after the 02:50 design was proven structurally
// broken on the Hobby plan).
//
// Render's free tier suspends the core service after ~15 min without inbound
// traffic, and the nightly forgetting-decay batch (syllabai.learner.decay-job,
// window anchored 03:00 UTC, prod profile) only completes when the JVM is up
// at a 15-min checker tick past the anchor. Missed windows self-heal
// (session-114: any wake completes the nightly promise; decay is anchored at
// last_practiced_at), so correctness never depends on this ping — only
// schedule precision does.
//
// Why "50 2 * * *" never worked (measured Sept 21-23, all three windows
// CATCH_UP ~2 h late, ledger decay_job_runs): Vercel Hobby cron jobs trigger
// ONCE PER DAY, WITHIN THE SCHEDULED HOUR — the minute field is not honored
// (documented Hobby limitation; verified against the 2026-09 platform docs).
// A fire anywhere in 02:00-02:44 wakes the instance for only ~15 min of idle
// budget, so it sleeps again BEFORE the 03:00 checker tick — the wake is
// invisible in every writable table and the window stays un-run until the
// (itself 3-5 h queue-delayed) pilot-monitor probe stumbles in around 04:50.
//
// "0 3 * * *" fires somewhere in the 03:00 UTC hour: the wake lands AFTER the
// window anchor, the first 15-min checker tick after the boot completes the
// window (trigger CATCH_UP, typically executed 03:03-03:20 — SCHEDULED needs
// the instance up before 03:00:00 sharp, which within-the-hour semantics
// cannot target). One bounded wake a day, same sanctioned decay-window
// purpose, now actually connected to the window it protects.
//
// Deliberately unauthenticated: this route only GETs the public health
// endpoint — no state, no credentials, no side effects beyond waking the
// instance. If a CRON_SECRET is ever set on the Vercel project, add a bearer
// check here.
//
// Timeout note: Hobby serverless functions cap at 60 s and Render cold starts
// have measured 105-184 s. The outbound request still reaches Render and
// wakes it even when this function gives up waiting — a timeout response
// here is therefore NOT a failure of the keep-alive purpose. The response
// body's latencyMs is the wake-duration reading for the Vercel dashboard's
// cron invocation log (the only place it is recorded — no Vercel token in
// any repo).

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
