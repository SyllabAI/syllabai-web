#!/usr/bin/env python3
"""Evidence-cycle final probe — the Smart Lesson response AFTER the round-2
marks fired the assessment evidence for the pilot monitor learner on the
targeted topic, plus the class/weakness state and the learner's marked
attempt history. Read-only.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BACKEND_URL", "https://syllabai-core.onrender.com").rstrip("/")
MONITOR_EMAIL = os.environ.get("MONITOR_EMAIL", "")
MONITOR_PASSWORD = os.environ.get("MONITOR_PASSWORD", "")
TEACHER_EMAIL = os.environ.get("TEACHER_EMAIL", "")
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")
TOPIC_ID = os.environ.get("TOPIC_ID", "70a48c9a-ce5a-4662-92a6-c825a2d50c54")
OUT_PATH = os.environ.get("RESULT_PATH", "s2-cycle-final.json")


def http(method, path, token=None, payload=None, timeout=300):
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
    out: dict = {"capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                 "topicId": TOPIC_ID}
    for _ in range(3):
        s, _ = http("GET", "/actuator/health", timeout=90)
        if s == 200:
            break
        time.sleep(10)
    mtok = login(MONITOR_EMAIL, MONITOR_PASSWORD)
    ttok = login(TEACHER_EMAIL, TEACHER_PASSWORD)
    if not mtok or not ttok:
        print("FAIL login")
        return 1

    s, subs = http("GET", "/api/v1/curriculum/subjects", token=mtok)
    rooted = [x for x in (subs or []) if x.get("knowledgeNodeId")]
    chm = next((x for x in rooted if (x.get("code") or "").startswith("4CH1")), None)
    root = chm["knowledgeNodeId"] if chm else None
    if not root:
        print("FAIL no 4CH1 root")
        return 1

    # 1. the monitor learner's smart lesson on the targeted topic (the closed
    #    loop's response to the marked evidence)
    s, lesson = http(
        "GET", f"/api/v1/learners/me/smart-lesson?rootId={root}&topicNodeId={TOPIC_ID}",
        token=mtok)
    out["smartLesson"] = lesson if isinstance(lesson, dict) else {"status": s}
    action = (lesson or {}).get("action") if isinstance(lesson, dict) else None
    print("smart-lesson action:", json.dumps(action))
    if isinstance(lesson, dict):
        print("evidence trace:")
        for e in (lesson.get("evidence") or [])[:8]:
            print("   -", json.dumps(e)[:180])

    # 2. the learner's attempt history on the targeted questions
    s, hist = http("GET", "/api/v1/learners/me/attempts?limit=50", token=mtok)
    attempts = hist if isinstance(hist, list) else ((hist or {}).get("attempts") if isinstance(hist, dict) else None)
    if attempts is not None:
        tgt = [a for a in attempts
               if a.get("questionId") in (
                   "96ae4235-2210-4327-811a-3bde94575e3a",
                   "ac5045d7-4af7-4843-811b-357039a73666",
                   "ddf30066-4905-4376-ae76-0630c263061a")]
        out["targetedAttempts"] = [{
            "questionId": a.get("questionId"),
            "marksAwarded": a.get("marksAwarded"),
            "marksTotal": a.get("marksTotal"),
            "correct": a.get("correct"),
            "createdAt": a.get("createdAt"),
        } for a in tgt]
        print(f"targeted attempts marked: {json.dumps(out['targetedAttempts'])}")

    # 3. teacher: weakness options (target topic aggregate after the evidence)
    s, wo = http("GET", f"/api/v1/teacher/tests/weakness-options?rootId={root}",
                 token=ttok)
    if s == 200:
        t = next((w for w in (wo.get("weakTopics") or [])
                  if w.get("topicNodeId") == TOPIC_ID), None)
        out["targetTopicFinal"] = t and {
            "code": t.get("code"), "reasons": t.get("reasons"),
            "learnersMeasured": t.get("learnersMeasured"),
            "meanMastery": t.get("meanMastery"),
            "evidenceBackedAttempts": t.get("evidenceBackedAttempts")}
        out["weakTopicCount"] = len(wo.get("weakTopics") or [])
        print(f"target topic final: {json.dumps(out.get('targetTopicFinal'))}")

    # 4. drill-down: the affected learners + representative evidence on the topic
    s, dd = http("GET", f"/api/v1/teacher/class/topics/{TOPIC_ID}/drill-down"
                        f"?rootId={root}", token=ttok)
    if s == 200 and isinstance(dd, dict):
        out["drillDown"] = {
            "topic": {"code": (dd.get("topic") or {}).get("code"),
                      "learnersMeasured": (dd.get("topic") or {}).get("learnersMeasured"),
                      "meanMastery": (dd.get("topic") or {}).get("meanMastery")},
            "affectedLearners": [{
                "displayName": a.get("displayName"),
                "mastery": a.get("mastery"),
                "reason": a.get("reason"),
            } for a in (dd.get("affectedLearners") or [])][:12],
            "evidenceCount": len(dd.get("representativeEvidence") or []),
            "representativeEvidence": [{
                "learner": e.get("learnerDisplayName"),
                "questionRef": e.get("questionRef"),
                "correct": e.get("correct"),
                "marks": e.get("marksAwarded"),
                "of": e.get("questionMarks"),
                "state": e.get("markingState"),
            } for e in (dd.get("representativeEvidence") or [])][:12],
        }
        print(f"drill-down: {json.dumps(out['drillDown'].get('topic'))} "
              f"affected={len(out['drillDown']['affectedLearners'])}")
    else:
        print(f"drill-down status={s}")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"written {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
