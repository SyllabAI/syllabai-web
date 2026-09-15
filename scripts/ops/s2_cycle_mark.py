#!/usr/bin/env python3
"""Evidence-cycle marking executor — applies the teacher's marks manifest.

The authoritative step of the legitimate teacher workflow: for every answer
in the committed marks manifest (the operator-directed teacher review,
sha-pinned), record the HUMAN MARK through the marking contract:

  POST /api/v1/teacher/marking/answers/{id}/human-mark
      { marksAwarded, perPointDecisions, comments }

Per-point decisions follow the marking UI's flow: the scope is seeded from
the answer's newest Smart Mark breakdown (exact server-side part scoping)
and set to the teacher's reviewed judgment. The first authoritative mark on
each structured attempt fires the evidence contract (BKT/BDT observe) —
that is the PENDING -> MARKED -> LEARNER EVIDENCE transition this cycle
exists to prove, in production.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 s2_cycle_mark.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BACKEND_URL", "https://syllabai-core.onrender.com").rstrip("/")
TEACHER_EMAIL = os.environ.get("TEACHER_EMAIL", "")
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")
MANIFEST_PATH = os.environ.get(
    "MANIFEST_PATH", os.path.join(os.path.dirname(__file__), "s2_marks_manifest.json"))
MANIFEST_SHA_INPUT = os.environ.get("MANIFEST_SHA_INPUT", "")
OUT_PATH = os.environ.get("RESULT_PATH", "s2-cycle-mark-result.json")


def http(method, path, token=None, payload=None, timeout=180):
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
    manifest = json.load(open(MANIFEST_PATH, encoding="utf-8"))
    body = {k: v for k, v in manifest.items() if k != "manifestSha256"}
    raw = json.dumps(body, indent=1, sort_keys=True).encode()
    sha = hashlib.sha256(raw).hexdigest()
    if MANIFEST_SHA_INPUT and MANIFEST_SHA_INPUT != sha:
        print(f"FAIL manifest sha mismatch: expected {MANIFEST_SHA_INPUT}, got {sha}")
        return 1
    print(f"manifest {manifest.get('manifestVersion')}: "
          f"{len(manifest.get('decisions') or [])} decisions, sha {sha[:16]}...")

    for _ in range(3):
        s, _ = http("GET", "/actuator/health", timeout=90)
        if s == 200:
            break
        time.sleep(10)
    else:
        print("FAIL health")
        return 1
    s, login = http("POST", "/api/v1/auth/login",
                    payload={"email": TEACHER_EMAIL, "password": TEACHER_PASSWORD})
    tok = (login or {}).get("accessToken") if s == 200 else None
    if not tok:
        print(f"FAIL teacher login status={s}")
        return 1
    print("teacher login OK")

    ok = conflict = missing = other_fail = 0
    results = []
    decisions = manifest.get("decisions") or []
    for idx, dec in enumerate(decisions):
        aid = dec["answerId"]
        # 1. read the answer's current state + newest smart-mark breakdown
        s, view = http("GET", f"/api/v1/teacher/marking/answers/{aid}", token=tok)
        points = None
        state = None
        if s == 200 and isinstance(view, dict):
            state = view.get("markingState")
            bd = ((view.get("latestSmartMark") or {}).get("breakdown")) or []
            if bd:
                points = {str(b.get("markPointId")): 0 for b in bd
                          if b.get("markPointId")}
        # 2. record the human mark (the authoritative step)
        s, mark = http("POST", f"/api/v1/teacher/marking/answers/{aid}/human-mark",
                       token=tok, payload={
                           "marksAwarded": dec["marksAwarded"],
                           "perPointDecisions": points,
                           "comments": dec["comment"],
                       })
        row = {"answerId": aid, "priorState": state, "httpStatus": s,
               "marks": dec["marksAwarded"], "pointsDecided": len(points or {})}
        if s == 201:
            ok += 1
            row["humanMarkId"] = (mark or {}).get("id")
            row["markedAt"] = (mark or {}).get("createdAt")
        elif s == 409:
            conflict += 1
            row["error"] = "409 conflict (marks outside part bound?)"
        elif s == 404:
            missing += 1
            row["error"] = "404 answer not found"
        else:
            other_fail += 1
            row["error"] = json.dumps(mark)[:200]
        results.append(row)
        if (idx + 1) % 25 == 0:
            print(f"  {idx + 1}/{len(decisions)} recorded "
                  f"(ok={ok} conflict={conflict} missing={missing} fail={other_fail})")

    # after-state: the throughput read model
    s, tp = http("GET", "/api/v1/teacher/marking/throughput", token=tok)
    throughput = tp if s == 200 else {"httpStatus": s}

    out = {
        "manifestSha256": sha,
        "manifestVersion": manifest.get("manifestVersion"),
        "startedAt": results[0]["markedAt"] if results and results[0].get("markedAt") else None,
        "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "totals": {"applied": ok, "conflict": conflict, "missing": missing,
                   "otherFail": other_fail, "total": len(decisions)},
        "throughputAfter": {
            "answersByState": throughput.get("answersByState"),
            "humanMarks24h": throughput.get("humanMarks24h"),
            "humanMarks7d": throughput.get("humanMarks7d"),
        },
        "results": results,
    }
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"human marks: applied={ok}/{len(decisions)} "
          f"(conflict={conflict} missing={missing} fail={other_fail})")
    print(f"throughput after: {json.dumps(out['throughputAfter']['answersByState'])}")
    print(f"written {OUT_PATH}")
    return 0 if ok == len(decisions) else 1


if __name__ == "__main__":
    sys.exit(main())
