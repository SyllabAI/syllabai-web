#!/usr/bin/env python3
"""Evidence-cycle queue dump — the marking teacher's working set.

Read-only against production: logs in as the pilot teacher (PILOT_TEACHER_*
secrets, the sanctioned Actions pattern), reads the deterministic marking
queue (queue-v2, PENDING) and, per paper group, the paper review view with
the mark scheme points (text + acceptance criteria + marks per point). Writes
one JSON artifact: every pending answer with its part prompt, answer text,
mark-scope and paper context — everything a teacher needs to judge marks
offline. Prints counts only, never secrets, never learner PII beyond display
names.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 s2_cycle_dump.py
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
OUT_PATH = os.environ.get("DUMP_PATH", "s2-cycle-dump.json")


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

    for attempt in range(1, 4):
        s, _ = http("GET", "/actuator/health", timeout=90)
        if s == 200:
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

    s, queue = http("GET", "/api/v1/teacher/marking/queue-v2?state=PENDING", token=tok)
    if s != 200:
        print(f"FAIL queue-v2 status={s}")
        return 1
    items = queue.get("items") or []
    groups = queue.get("groups") or []
    print(f"queue-v2: {len(items)} pending over {len(groups)} paper group(s)")

    # per-paper review view (mark scheme points), one request per DISTINCT paper
    papers: dict[str, dict] = {}
    for g in groups:
        pid = g.get("paperId")
        if pid and pid not in papers:
            s2, review = http(
                "GET", f"/api/v1/teacher/content/exam-papers/{pid}/review", token=tok,
                timeout=180)
            if s2 != 200:
                print(f"WARN paper review {pid} status={s2}")
                papers[pid] = {"error": s2}
            else:
                papers[pid] = review
                nv = len(review.get("versions") or [])
                print(f"paper {g.get('paperCode')}: {nv} question version(s) with schemes")

    dump = {
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "queueState": queue.get("state"),
        "groups": [
            {"paperId": g.get("paperId"), "title": g.get("paperTitle"),
             "code": g.get("paperCode"), "session": g.get("sessionLabel"),
             "count": g.get("count"), "oldestPendingAt": g.get("oldestPendingAt")}
            for g in groups],
        "papers": {pid: {
            "title": (r.get("paper") or {}).get("title"),
            "code": (r.get("paper") or {}).get("paperCode"),
            "sessionLabel": (r.get("paper") or {}).get("sessionLabel"),
            "versions": [{
                "questionId": v.get("questionId"),
                "externalRef": v.get("externalRef"),
                "type": v.get("type"),
                "stem": v.get("stem"),
                "marks": v.get("marks"),
                "schemeState": v.get("schemeState"),
                "parts": v.get("parts"),
                "points": v.get("points"),
            } for v in (r.get("versions") or [])],
        } for pid, r in papers.items() if "error" not in r},
        "items": [],
    }

    for i, it in enumerate(items):
        a = it.get("answer") or {}
        dump["items"].append({
            "order": i,
            "answerId": a.get("answerId"),
            "attemptId": a.get("attemptId"),
            "learnerId": a.get("learnerId"),
            "learnerDisplayName": a.get("learnerDisplayName"),
            "questionId": a.get("questionId"),
            "questionExternalRef": a.get("questionExternalRef"),
            "partLabel": a.get("partLabel"),
            "partPrompt": a.get("partPrompt"),
            "partMarks": a.get("partMarks"),
            "answerText": a.get("answerText"),
            "markingState": a.get("markingState"),
            "paperId": it.get("paperId"),
            "paperCode": it.get("paperCode"),
            "nextAnswerId": it.get("nextAnswerId"),
        })

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(dump, f, indent=1, sort_keys=True)
    print(f"dump written: {OUT_PATH} ({len(dump['items'])} items, "
          f"{len(dump['papers'])} papers)")

    # quick shape summary for the log (no PII)
    by_paper = {}
    for it in dump["items"]:
        by_paper[it.get("paperCode") or "?"] = by_paper.get(it.get("paperCode") or "?", 0) + 1
    print("pending by paper:", json.dumps(by_paper, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
