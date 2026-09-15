# syllabai-web

SyllabAI frontend — **Next.js 16 / React 19 / TypeScript** Learner Workbench (Vercel deployment).

> Part of the SyllabAI project · master pack: [`SyllabAI/syllabai`](https://github.com/SyllabAI/syllabai) · backend: [`SyllabAI/syllabai-core`](https://github.com/SyllabAI/syllabai-core)

## What's implemented

The frontend has grown well beyond the original Wave 0 three-view workbench
(T-005 — its full description is preserved in git history). Current state,
2026-09-15, aligned with the V20 production reconciliation:

- **Learner side** — sign in / register (JWT auth; token in localStorage,
  httpOnly-cookie hardening tracked), Practice player with confidence slider /
  self-doubt flag / timed-mode telemetry (Paper B §3.5 / §16), Mastery map
  (BKT with Ebbinghaus decay + remediation chains), My state (BKT/BDT +
  review queue), Dashboard, History, Next-best actions, Smart Lesson,
  Tutor chat, Past Papers browser, Knowledge Graph view.
- **Teacher side** — Teacher Review, Test Builder (marks UI), Teacher Content,
  Class Intelligence and Concept Graph views.
- **Ops & verification** — `scripts/ops/v20_battery.py` +
  `.github/workflows/v20-verify.yml` (the V20 teacher-side production battery:
  GREEN 55/55 at deployed core `26fec63`, run 34896406018), plus the pilot
  monitor, s2 census/class/marking probes, content-export and Google Drive
  sync workflows.

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
