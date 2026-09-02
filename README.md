# syllabai-web

SyllabAI web frontend — **Next.js 16 App Router** experience for students, teachers, and admins.

> Part of the SyllabAI project · master pack: [`SyllabAI/syllabai`](https://github.com/SyllabAI/syllabai) · the Java backend lives in [`syllabai-core`](https://github.com/SyllabAI/syllabai-core) (Vercel has no Java runtime — the split is mandatory).

## Stack (locked, ADR-002)

- **Next.js 16.3.x (Active LTS) + React 19 + TypeScript**
- Tailwind CSS 4 + shadcn/ui-compatible components
- Deployed on **Vercel Hobby** (free, no credit card)
- Typed API client generated from the backend OpenAPI spec (`/api/v1`)
- SSE streaming for tutor chat; PDF.js viewer for past papers with mark-scheme toggle; react-force-graph/d3 mastery map

## Cycle-1 surfaces

- Auth (login/register, roles)
- Student: mastery map (KG visualizer), tutor chat with **verbatim citations**, question practice (timed/untimed), Smart Mark feedback, personal dashboard
- Teacher (minimal): class list, Smart Mark review queue, overrides
- Accessibility baseline: WCAG 2.1 AA (A11Y.md contract in the main repo)

## Rules

- No business rules here — the frontend is a view layer; authorization is server-side in `syllabai-core`.
- Cold-start UX: handle backend wake-up (Render free tier) with retry states, never lose user input (F-156).

## Status

Not started. Bootstrap task: **T-005** in the main repo's `TODO.md` (Wave 0).
