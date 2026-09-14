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
