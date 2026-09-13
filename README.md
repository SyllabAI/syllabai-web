# syllabai-web

SyllabAI frontend — **Next.js 16 / React 19 / TypeScript** Learner Workbench (Vercel deployment).

> Part of the SyllabAI project · master pack: [`SyllabAI/syllabai`](https://github.com/SyllabAI/syllabai) · backend: [`SyllabAI/syllabai-core`](https://github.com/SyllabAI/syllabai-core)

## What's implemented (Wave 0, T-005)

A single-page **Learner Workbench** (`src/app/page.tsx`) with three views over the
Java backend's `/api/v1`:

- **Sign in / register** — JWT auth against the Spring Boot API (Bearer token; v0
  keeps the token in localStorage, httpOnly-cookie hardening is tracked for Wave 4).
- **Practice** — question player with options, confidence slider (1–5), self-doubt
  flag and timed-mode checkbox (Paper B §3.5 / §16 telemetry inputs), immediate
  feedback including misconception signals from the chosen distractor.
- **Mastery map** — Edexcel IGCSE Chemistry knowledge tree (units → topics →
  subtopics) with BKT mastery bars (effective mastery after Ebbinghaus decay),
  known-misconception lists per topic and the prerequisite remediation chain.
- **My state** — BKT skill table (stored vs effective mastery), BDT misconception
  watch (probability, active flag) and the decay-driven review queue.

Typed API client in `src/lib/api.ts` (mirrors the backend DTOs, Master Spec §22).

## Stack

- Next.js 16 (App Router), React 19, TypeScript 5
- Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons
- State: React hooks + fetch (TanStack Query/Zustand available for Wave 2+ scale)

## Development

```bash
bun install        # or npm install
bun run dev        # http://localhost:3000
```

The workbench talks to the backend through `NEXT_PUBLIC_API_BASE_URL`
(e.g. `https://syllabai-core.onrender.com` — see `.env.example`).
When unset, requests go to same-origin `/api/v1/...` — useful behind the
sandbox gateway or a reverse proxy.

## Deployment (Vercel)

**Status: LIVE at <https://syllabai-web.vercel.app>** (deployed 2026-09-10;
`NEXT_PUBLIC_API_BASE_URL=https://syllabai-core.onrender.com` verified baked
into the production bundle by direct chunk inspection).

1. Import this repo on Vercel (Hobby plan, $0).
2. Set env var `NEXT_PUBLIC_API_BASE_URL` = the Render URL of `syllabai-core`
   (bare origin, no trailing `/api/v1`; inlined at build time — changing it
   requires a redeploy).
3. **Required, not optional:** the backend's `SYLLABAI_CORS_ORIGINS` (Render
   dashboard → syllabai-core → Environment) must include
   `https://syllabai-web.vercel.app`. The backend default allow-list covers
   `https://syllabai.vercel.app` — a different project name — so browser
   sign-in fails with CORS 403 until this is set (empirically confirmed
   2026-09-10).

## Tests / CI

`.github/workflows/ci.yml` runs lint + production build on Node 22.
Component/UI tests (Playwright) are Wave 2 scope.
