#!/usr/bin/env python3
"""Sprint-2 §2-§5 production verification — the class-intelligence read model.

Runs from GitHub Actions (web repo, workflow_dispatch) with the PILOT_TEACHER_*
secrets — the same sanctioned pattern as the census, monitor and V20 battery.
Read-only: only GET endpoints, no data mutation, prints counts (never secrets),
writes the JSON snapshot for the workflow artifact.

Verifies, against PRODUCTION:
  deploy        the class surface exists and reports policy class-analytics/v1
                (a 404 here means Render has not picked up 45b5ec3 yet)
  overview      cohort / evidence reach / coverage / heatmap honesty — every
                topic with zero measured learners carries null meanMastery and
                band UNMEASURED (nothing fabricated, §4)
  learners      per-learner rows: UNMEASURED rows carry null mastery; measured
                rows order first (attention order), engagement counted in its
                own fields
  drill-down    one real topic (first measured, else first servable): topic
                aggregate, prerequisite chain, affected learners, evidence
                items with marking states, servable questions
  invariants    subject isolation is structural (rootId scoping); RBAC and
                read-only-ness are CI-proven (ClassAnalyticsFlowIT) — this
                probe records the live shape only.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 s2_class_probe.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BACKEND_URL", "https://syllabai-core.onrender.com").rstrip("/")
TEACHER_EMAIL = os.environ.get("TEACHER_EMAIL", "")
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")
OUT_PATH = os.environ.get("PROBE_PATH", "s2-class-probe.json")


def http(method, path, token=None, payload=None, timeout=120):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body or "null")
        except Exception:
            return e.code, {"raw": body[:300]}


def main() -> int:
    assert TEACHER_EMAIL and TEACHER_PASSWORD, "PILOT_TEACHER_* must be set"
    snapshot: dict = {}
    failures: list[str] = []

    # free-tier cold start tolerance
    for attempt in range(1, 4):
        s, _ = http("GET", "/actuator/health", timeout=90)
        if s == 200:
            print(f"health UP (attempt {attempt})")
            break
        time.sleep(10)
    else:
        print("FAIL backend health")
        return 1

    s, login = http("POST", "/api/v1/auth/login",
                    payload={"email": TEACHER_EMAIL, "password": TEACHER_PASSWORD})
    tok = login.get("accessToken") if isinstance(login, dict) else None
    if s != 200 or not tok:
        print(f"FAIL teacher login status={s}")
        return 1
    print("teacher login OK")

    # subject root for the class surface (4CH1 first, else first rooted subject)
    s, subjects = http("GET", "/api/v1/curriculum/subjects", token=tok)
    if s != 200 or not isinstance(subjects, list) or not subjects:
        print(f"FAIL subjects status={s}")
        return 1
    root = next((sub for sub in subjects
                 if sub.get("code") == "4CH1" and sub.get("knowledgeNodeId")), None)
    if root is None:
        root = next((sub for sub in subjects if sub.get("knowledgeNodeId")), None)
    if root is None:
        print("FAIL no rooted subject — the class surface needs a knowledgeNodeId")
        return 1
    root_id = root["knowledgeNodeId"]
    print(f"subject: {root.get('code')} rootId={root_id}")
    snapshot["subject"] = {"code": root.get("code"), "rootId": root_id}

    # ── overview ──────────────────────────────────────────────────────
    s, overview = http("GET", f"/api/v1/teacher/class/overview?rootId={root_id}")
    if s != 200:
        print(f"FAIL class overview status={s} (deploy current? policy exists since 45b5ec3)")
        return 1
    if overview.get("policy") != "class-analytics/v1":
        failures.append(f"policy={overview.get('policy')!r}")
    topics = overview.get("topics") or []
    unmeasured = [t for t in topics if (t.get("learnersMeasured") or 0) == 0]
    dishonest = [t["code"] for t in unmeasured
                 if t.get("meanMastery") is not None or t.get("masteryBand") != "UNMEASURED"]
    if dishonest:
        failures.append(f"fabricated values on unmeasured topics: {dishonest[:5]}")
    measured = [t for t in topics if (t.get("learnersMeasured") or 0) > 0]
    weak = overview.get("weakPrerequisites") or []
    ra = overview.get("recentActivity") or {}
    snapshot["overview"] = {
        "policy": overview.get("policy"),
        "enrolledLearners": overview.get("enrolledLearners"),
        "learnersWithEvidence": overview.get("learnersWithEvidence"),
        "learnersRecentlyActive": overview.get("learnersRecentlyActive"),
        "totalTopics": overview.get("totalTopics"),
        "measuredTopics": overview.get("measuredTopics"),
        "weakPrerequisites": len(weak),
        "recentAttempts": ra.get("recentAttempts"),
        "tutorAsks": ra.get("tutorAsks"),
        "pendingMarking": ra.get("structuredAnswersPendingMarking"),
        "measuredTopicCells": [
            {"code": t.get("code"), "learners": t.get("learnersMeasured"),
             "mean": t.get("meanMastery"), "band": t.get("masteryBand"),
             "miscoSignals": t.get("activeMisconceptionSignals"),
             "servable": t.get("servableQuestions")}
            for t in measured[:10]],
    }
    print(f"overview OK: enrolled={overview.get('enrolledLearners')} "
          f"withEvidence={overview.get('learnersWithEvidence')} "
          f"topics={overview.get('measuredTopics')}/{overview.get('totalTopics')} measured "
          f"weakPrereq={len(weak)} recentAttempts={ra.get('recentAttempts')}")

    # ── learners ──────────────────────────────────────────────────────
    s, learners = http("GET", f"/api/v1/teacher/class/learners?rootId={root_id}")
    if s != 200 or not isinstance(learners, list):
        print(f"FAIL class learners status={s}")
        return 1
    unmeasured_rows = [l for l in learners if l.get("evidenceState") == "UNMEASURED"]
    bad_rows = [l.get("displayName") for l in unmeasured_rows if l.get("meanMastery") is not None]
    if bad_rows:
        failures.append(f"fabricated mastery on unmeasured learners: {bad_rows[:5]}")
    # attention order: a measured row must never follow an unmeasured row
    seen_unmeasured = False
    order_ok = True
    for l in learners:
        if l.get("evidenceState") == "UNMEASURED":
            seen_unmeasured = True
        elif seen_unmeasured:
            order_ok = False
            break
    if not order_ok:
        failures.append("learner order: measured row after unmeasured row")
    snapshot["learners"] = {
        "rows": len(learners),
        "measured": len(learners) - len(unmeasured_rows),
        "unmeasured": len(unmeasured_rows),
        "withActiveMisconceptions": sum(1 for l in learners
                                        if (l.get("activeMisconceptions") or 0) > 0),
        "withTutorEngagement": sum(1 for l in learners
                                   if (l.get("tutorEngagements") or 0) > 0),
    }
    print(f"learners OK: {len(learners)} rows "
          f"({len(learners) - len(unmeasured_rows)} measured, {len(unmeasured_rows)} unmeasured), "
          f"attention order {'OK' if order_ok else 'VIOLATED'}")

    # ── drill-down on one real topic ──────────────────────────────────
    target = measured[0] if measured else next(
        (t for t in topics if (t.get("servableQuestions") or 0) > 0), None)
    if target is not None:
        node_id = target["nodeId"]
        s, dd = http("GET", f"/api/v1/teacher/class/topics/{node_id}/drill-down?rootId={root_id}")
        if s != 200:
            failures.append(f"drill-down status={s}")
        else:
            chain = dd.get("prerequisiteChain") or []
            bad_chain = [p.get("code") for p in chain
                         if (p.get("learnersMeasured") or 0) == 0
                         and (p.get("meanMastery") is not None
                              or p.get("masteryBand") != "UNMEASURED")]
            if bad_chain:
                failures.append(f"fabricated prerequisite values: {bad_chain[:5]}")
            snapshot["drillDown"] = {
                "topic": target.get("code"),
                "prerequisiteChain": len(chain),
                "affectedLearners": len(dd.get("affectedLearners") or []),
                "evidenceItems": len(dd.get("representativeEvidence") or []),
                "servableQuestions": len(dd.get("servableQuestions") or []),
            }
            print(f"drill-down OK on {target.get('code')}: "
                  f"chain={len(chain)} affected={len(dd.get('affectedLearners') or [])} "
                  f"evidence={len(dd.get('representativeEvidence') or [])} "
                  f"servable={len(dd.get('servableQuestions') or [])}")

    snapshot["failures"] = failures
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=1, sort_keys=True)
    if failures:
        print(f"FAIL invariants: {failures}")
        return 1
    print("class-intelligence production probe: ALL OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
