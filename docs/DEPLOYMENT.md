# Deployment — syllabai-web on Vercel

## Pipeline

- Project: `syllabai-web` (Vercel team `Syllab AI`, project id `prj_Ml3uFu8mVl4ElgFv4q1NdGaU5DB0`).
- Git integration: GitHub `SyllabAI/syllabai-web`, production branch `main`, auto-deploy on push.
- Production domain: `https://syllabai-web.vercel.app` (automatic aliases
  `syllabai-web-syllab-ai.vercel.app`, `syllabai-web-git-main-syllab-ai.vercel.app`).
- Framework: Next.js (zero-config build; no custom build/output commands set).

## Commit author requirement (COMMIT_AUTHOR_REQUIRED)

Vercel (hobby plan) verifies the **commit author email** of every pushed commit against
Git accounts linked to the Vercel team. A production deployment whose commit author email
is not a verified email of a linked GitHub account is **BLOCKED** with:

```
readyStateReason: The deployment was blocked because Vercel couldn't find a Git account
                  for the commit author.
seatBlock: COMMIT_AUTHOR_REQUIRED
```

Verified identity for this repo: `SyllabAI <hussaina269a@gmail.com>` (the GitHub account
owner's primary email). Commits authored with any other email — e.g. bot containers or
unverified personal addresses — will build nothing and silently leave production stale.

**Rule for all future commits pushed to `main`:** author and committer must be

```
git config user.name  "SyllabAI"
git config user.email "hussaina269a@gmail.com"
```

Deploy state can be checked via `GET /v6/deployments?projectId=prj_Ml3uFu8mVl4ElgFv4q1NdGaU5DB0&target=production`
(Authorization: Bearer <token>) — `readyState` must be `READY` with `githubCommitSha`
matching the pushed tip.

## Free-tier resilience (2026-09-23)

The Spring Boot core runs on Render's free instance (spins down after ~15 min
idle; a wake is a full JVM + Spring boot). The client now carries the load
strategy (see `src/lib/api-cache.ts` + `src/lib/api.ts`):

- **Content cache** — `localStorage` stale-while-revalidate (6 h TTL) for
  user-independent content GETs: `subjects`, `knowledgeTree`, `prerequisites`,
  `questions`, `conceptGraphEdges`, `examPapers`, `examPaper`. Returning
  visitors render from cache and never wake the sleeping backend. Teacher
  content mutations (validate/place/reject/flag/unflag/topic-map/validate-all/
  concept-graph activate) invalidate the whole content cache on success.
- **Per-user read models are never cached** — learner state, attempts,
  history, recommendations, knowledge graph, smart lesson, tutor/CLA always
  hit the server (they must reflect live evidence).
- **Single-flight GETs** — identical in-flight GETs share one request.
- **One wake ping per browser session** — `wakeBackend()` fires a single
  unauthenticated `GET /actuator/health` when the login screen mounts, so the
  Render boot overlaps credential typing. Guarded by sessionStorage.
- **Honest cold-start UX** — requests slower than 3 s with no recent success
  raise `syllabai:backend-waking` (the `BackendStatus` banner explains the
  free-tier wake instead of a silent spinner); network-failed GETs retry once;
  the login screen's "cannot reach" message names the cold start.

**Hard rule — do not add an uptime pinger/keep-alive timer for the Render
service.** Render's ToS prohibit defeating free-tier spin-down that way and
it risks account suspension. The per-session login ping above is tied to a
real page view and is the maximum acceptable. The 6-hourly `pilot-monitor`
GitHub Action is availability monitoring — do not increase its frequency.
