#!/usr/bin/env python3
"""Evidence-cycle closing leg — weakness -> targeted test -> new attempts ->
Smart Lesson response, in production, with the teacher + a real learner
account (the pilot monitor learner).

What this proves live (the §22 product loop, production evidence cycle):
  WEAKNESS IDENTIFIED  teacher weakness-options (transparent reasons)
  TARGETED TEST        teacher test-builder preview on the weak topic
  NEW ATTEMPTS         the monitor learner attempts the targeted questions
                       (MCQ correct options from the teacher answer key;
                       structured answers from the scheme point texts) —
                       a controlled remediation input, honestly labeled
  SMART LESSON         the learner's smart-lesson on the topic re-queried
  RESPONSE             after the new evidence; the action/evidence must
                       reflect it (closed loop)

Reads + the learner's own attempts only; no direct state writes. Writes the
full cycle JSON artifact.
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
OUT_PATH = os.environ.get("RESULT_PATH", "s2-cycle-after.json")


def http(method, path, token=None, payload=None, timeout=240):
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
    assert MONITOR_EMAIL and MONITOR_PASSWORD and TEACHER_EMAIL and TEACHER_PASSWORD
    cycle: dict = {"capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    for _ in range(3):
        s, _ = http("GET", "/actuator/health", timeout=90)
        if s == 200:
            break
        time.sleep(10)
    else:
        print("FAIL health")
        return 1

    mtok = login(MONITOR_EMAIL, MONITOR_PASSWORD)
    ttok = login(TEACHER_EMAIL, TEACHER_PASSWORD)
    if not mtok or not ttok:
        print("FAIL login (monitor/teacher)")
        return 1

    s, subs = http("GET", "/api/v1/curriculum/subjects", token=mtok)
    rooted = [x for x in (subs or []) if x.get("knowledgeNodeId")]
    chm = next((x for x in rooted if (x.get("code") or "").startswith("4CH1")), None)
    if not chm:
        print("FAIL no rooted 4CH1")
        return 1
    root = chm["knowledgeNodeId"]
    cycle["root4ch1"] = root

    # ── 1. WEAKNESS IDENTIFIED ─────────────────────────────────────────
    s, wo = http("GET", f"/api/v1/teacher/tests/weakness-options?rootId={root}",
                 token=ttok, timeout=300)
    if s != 200:
        print(f"FAIL weakness-options {s}")
        return 1
    weak = wo.get("weakTopics") or []
    cycle["weaknessOptions"] = {
        "enrolled": wo.get("enrolledLearners"),
        "withEvidence": wo.get("learnersWithEvidence"),
        "weakTopics": [{"code": w.get("code"), "topicNodeId": w.get("topicNodeId"),
                        "reasons": w.get("reasons"),
                        "learnersMeasured": w.get("learnersMeasured"),
                        "meanMastery": w.get("meanMastery"),
                        "servableQuestions": w.get("servableQuestions")}
                       for w in weak],
    }
    targetable = [w for w in weak if (w.get("servableQuestions") or 0) > 0]
    if not targetable:
        print("FAIL no targetable weak topic (servableQuestions=0 everywhere)")
        return 1
    # most class evidence first, then weakest mean, then code (deterministic)
    target = sorted(targetable, key=lambda w: (-(w.get("learnersMeasured") or 0),
                                               w.get("meanMastery") or 0.0,
                                               w.get("code") or ""))[0]
    cycle["targetTopic"] = {"code": target.get("code"),
                            "topicNodeId": target.get("topicNodeId"),
                            "reasons": target.get("reasons"),
                            "learnersMeasured": target.get("learnersMeasured"),
                            "meanMastery": target.get("meanMastery")}
    print(f"target weak topic: {target.get('code')} "
          f"(measured={target.get('learnersMeasured')}, "
          f"mean={target.get('meanMastery')}, servable={target.get('servableQuestions')})")
    topic_id = target.get("topicNodeId")

    # ── 2. TARGETED TEST ───────────────────────────────────────────────
    s, preview = http(
        "GET", f"/api/v1/teacher/tests/preview?rootId={root}&topicNodeIds={topic_id}"
               f"&includeAnswers=true", token=ttok, timeout=300)
    if s != 200:
        print(f"FAIL targeted preview {s}")
        return 1
    cycle["targetedTest"] = {
        "questionCount": preview.get("questionCount"),
        "totalMarks": preview.get("totalMarks"),
        "questions": [{"id": q.get("id"), "type": q.get("type"),
                       "topicCode": q.get("topicCode"), "marks": q.get("marks"),
                       "stem": (q.get("stem") or "")[:140]}
                      for q in (preview.get("questions") or [])],
        "answerKeyEntries": sum(len(q.get("answers") or [])
                                for q in (preview.get("questions") or [])),
    }
    print(f"targeted test: {preview.get('questionCount')} questions, "
          f"{preview.get('totalMarks')} marks, "
          f"{cycle['targetedTest']['answerKeyEntries']} answer-key entries")

    # ── 3. the learner's servable set on the topic + the teacher key ────
    s, practice = http("GET", f"/api/v1/questions?topicNodeId={topic_id}",
                       token=mtok, timeout=300)
    practice = practice or []
    cycle["servableOnTopic"] = [{"id": q.get("id"), "type": q.get("type"),
                                 "marks": q.get("marks"),
                                 "paperId": q.get("examPaperId")}
                                for q in practice]
    print(f"learner practice list on topic: {len(practice)} questions")

    # teacher answer key per question (correct MCQ options / scheme texts)
    key: dict[str, dict] = {}
    for q in practice:
        pid = q.get("examPaperId")
        if not pid:
            continue
        if pid not in key:
            s, review = http(
                "GET", f"/api/v1/teacher/content/exam-papers/{pid}/review",
                token=ttok, timeout=300)
            key[pid] = review if s == 200 else {"error": s}
        review = key[pid]
        if "error" in review:
            continue
        for v in review.get("versions") or []:
            if v.get("questionId") != q.get("id"):
                continue
            entry = {"type": v.get("type"), "correctOptionId": None,
                     "partAnswers": {}}
            if v.get("type") == "MCQ":
                for o in v.get("options") or []:
                    if o.get("correct"):
                        entry["correctOptionId"] = o.get("id")
                        break
            else:
                # scheme point texts per part label (ref suffix match, then
                # whole-question points) — the marking round that follows will
                # judge them properly; these are answer-key remediation inputs
                for p in v.get("parts") or []:
                    texts = [p2.get("text") for p2 in (v.get("points") or [])
                             if p2.get("ref") == p.get("label")
                             or (p2.get("ref") or "").endswith("-" + p.get("label"))]
                    if not texts:
                        texts = [p2.get("text") for p2 in (v.get("points") or [])
                                 if not p2.get("ref")]
                    entry["partAnswers"][p.get("id")] = " ; ".join(
                        t for t in texts if t)[:500]
            key[q.get("id")] = entry
            break

    # ── 4. SMART LESSON BEFORE ─────────────────────────────────────────
    s, before = http(
        "GET", f"/api/v1/learners/me/smart-lesson?rootId={root}&topicNodeId={topic_id}",
        token=mtok, timeout=300)
    cycle["smartLessonBefore"] = {
        "status": s,
        "policy": (before or {}).get("policy") if isinstance(before, dict) else None,
        "action": (before or {}).get("action") if isinstance(before, dict) else None,
        "evidenceCount": len((before or {}).get("evidence") or [])
        if isinstance(before, dict) else 0,
    }
    print(f"smart-lesson before: {json.dumps(cycle['smartLessonBefore'].get('action'))}")

    # ── 5. NEW ATTEMPTS (the learner works the targeted questions) ─────
    attempts = []
    for q in practice:
        k = key.get(q.get("id")) or {}
        if q.get("type") == "MCQ" and k.get("correctOptionId"):
            s, res = http("POST", "/api/v1/attempts", token=mtok, payload={
                "questionId": q.get("id"),
                "chosenOptionId": k["correctOptionId"],
                "responseTimeMs": 14000,
                "confidence": 4,
                "selfDoubtFlag": False,
                "timedCondition": False,
            })
            attempts.append({"questionId": q.get("id"), "type": "MCQ", "status": s,
                             "correct": (res or {}).get("correct")
                             if isinstance(res, dict) else None,
                             "marksAwarded": (res or {}).get("marksAwarded")
                             if isinstance(res, dict) else None})
        elif q.get("type") != "MCQ" and k.get("partAnswers"):
            parts = [{"partId": pid, "answerText": txt}
                     for pid, txt in k["partAnswers"].items()]
            if not parts:
                parts = [{"partId": p.get("id"), "answerText": ""}
                         for p in (q.get("parts") or [])]
            s, res = http("POST", "/api/v1/attempts/structured", token=mtok, payload={
                "questionId": q.get("id"),
                "partAnswers": parts,
                "responseTimeMs": 45000,
                "confidence": 3,
                "selfDoubtFlag": False,
                "timedCondition": False,
            })
            attempts.append({"questionId": q.get("id"), "type": "STRUCTURED",
                             "status": s,
                             "markingState": (res or {}).get("markingState")
                             if isinstance(res, dict) else None})
        else:
            attempts.append({"questionId": q.get("id"), "type": q.get("type"),
                             "status": "SKIPPED_NO_KEY"})
        time.sleep(1)
    cycle["newAttempts"] = attempts
    ok = [a for a in attempts if a.get("status") == 201]
    print(f"new attempts: {len(ok)}/{len(attempts)} accepted "
          f"({sum(1 for a in attempts if a.get('correct'))} correct MCQ, "
          f"{sum(1 for a in attempts if a.get('type') == 'STRUCTURED' and a.get('status') == 201)} structured->PENDING)")

    # ── 6. SMART LESSON AFTER (the closed-loop response) ───────────────
    time.sleep(3)
    s, after = http(
        "GET", f"/api/v1/learners/me/smart-lesson?rootId={root}&topicNodeId={topic_id}",
        token=mtok, timeout=300)
    cycle["smartLessonAfter"] = {
        "status": s,
        "policy": (after or {}).get("policy") if isinstance(after, dict) else None,
        "action": (after or {}).get("action") if isinstance(after, dict) else None,
        "evidence": (after or {}).get("evidence") if isinstance(after, dict) else None,
    }
    b, a = cycle["smartLessonBefore"], cycle["smartLessonAfter"]
    changed = (b.get("action") or {}) != (a.get("action") or {})
    cycle["closedLoop"] = {
        "actionChanged": changed,
        "beforeReason": (b.get("action") or {}).get("reasonCode"),
        "afterReason": (a.get("action") or {}).get("reasonCode"),
    }
    print(f"smart-lesson after: {json.dumps(a.get('action'))}")
    print(f"closed loop: actionChanged={changed}")

    # ── 7. class view after the new evidence ───────────────────────────
    s, wo2 = http("GET", f"/api/v1/teacher/tests/weakness-options?rootId={root}",
                  token=ttok, timeout=300)
    if s == 200:
        t2 = next((w for w in (wo2.get("weakTopics") or [])
                   if w.get("topicNodeId") == topic_id), None)
        cycle["targetTopicAfterAttempts"] = t2 and {
            "code": t2.get("code"), "reasons": t2.get("reasons"),
            "learnersMeasured": t2.get("learnersMeasured"),
            "meanMastery": t2.get("meanMastery")}
        print(f"target topic after attempts: {json.dumps(cycle['targetTopicAfterAttempts'])}")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(cycle, f, indent=1, sort_keys=True)
    print(f"written {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
