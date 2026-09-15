#!/usr/bin/env python3
"""Evidence-cycle precheck — read-only production state relevant to the loop.

Monitor learner: subjects, the 4CH1 practice list (servable VALIDATED
questions) with their topic distribution. Teacher: current weakness options.
Writes a JSON snapshot; prints counts only.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter

BASE = os.environ.get("BACKEND_URL", "https://syllabai-core.onrender.com").rstrip("/")
MONITOR_EMAIL = os.environ.get("MONITOR_EMAIL", "")
MONITOR_PASSWORD = os.environ.get("MONITOR_PASSWORD", "")
TEACHER_EMAIL = os.environ.get("TEACHER_EMAIL", "")
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")
OUT_PATH = os.environ.get("PROBE_PATH", "s2-cycle-precheck.json")


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


def login(email, password):
    s, body = http("POST", "/api/v1/auth/login",
                  payload={"email": email, "password": password})
    return (body or {}).get("accessToken") if s == 200 else None


def main() -> int:
    snap: dict = {"capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    for _ in range(3):
        s, _ = http("GET", "/actuator/health", timeout=90)
        if s == 200:
            break
        time.sleep(10)
    else:
        print("FAIL health")
        return 1

    mtok = login(MONITOR_EMAIL, MONITOR_PASSWORD)
    if not mtok:
        print("FAIL monitor login")
        return 1
    s, subs = http("GET", "/api/v1/curriculum/subjects", token=mtok)
    rooted = [x for x in (subs or []) if x.get("knowledgeNodeId")]
    chm = next((x for x in rooted if (x.get("code") or "").startswith("4CH1")), None)
    if not chm:
        print("FAIL no rooted 4CH1 subject")
        return 1
    root = chm["knowledgeNodeId"]
    snap["root4ch1"] = root
    s, qs = http("GET", f"/api/v1/questions?rootId={root}", token=mtok, timeout=180)
    serving = qs or []
    # count by primaryTopicNodeId (StudentQuestionView carries ids, not codes);
    # resolve codes through the teacher weakness/coverage views later — the id
    # histogram is the servability fact that matters here
    topics = Counter(str(q.get("primaryTopicNodeId")) for q in serving
                     if q.get("primaryTopicNodeId"))
    snap["servingQuestions"] = len(serving)
    snap["servingByTopicNodeId"] = dict(topics.most_common())
    snap["servingQuestionIds"] = [q.get("id") for q in serving]
    print(f"4CH1 serving: {len(serving)} questions over {len(topics)} topic ids")

    ttok = login(TEACHER_EMAIL, TEACHER_PASSWORD)
    if ttok:
        s, wo = http("GET", f"/api/v1/teacher/tests/weakness-options?rootId={root}",
                     token=ttok, timeout=180)
        if s == 200:
            snap["weaknessOptions"] = {
                "enrolled": wo.get("enrolledLearners"),
                "withEvidence": wo.get("learnersWithEvidence"),
                "weak": [{
                    "code": w.get("code"), "reasons": w.get("reasons"),
                    "learnersMeasured": w.get("learnersMeasured"),
                    "meanMastery": w.get("meanMastery"),
                    "servableQuestions": w.get("servableQuestions"),
                } for w in (wo.get("weakTopics") or [])],
                "coverageGaps": [{
                    "code": g.get("code"), "servableQuestions": g.get("servableQuestions"),
                    "evidenceBackedAttempts": g.get("evidenceBackedAttempts"),
                } for g in (wo.get("coverageGaps") or [])],
            }
            print(f"weakness: {len(wo.get('weakTopics') or [])} weak, "
                  f"{len(wo.get('coverageGaps') or [])} coverage gaps")
        else:
            print(f"weakness-options status={s}")
    else:
        print("teacher login failed (monitor-only precheck)")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(snap, f, indent=1, sort_keys=True)
    print(f"written {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
