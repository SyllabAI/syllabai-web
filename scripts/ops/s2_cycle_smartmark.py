#!/usr/bin/env python3
"""Evidence-cycle smart-mark assist — the marking UI's per-group batch flow.

The teacher's marking workflow step: for each paper group in the deterministic
queue, run the bounded Smart Mark batch (the product's "compare against the
mark scheme via Smart Mark" assist). Marks stay PROVISIONAL (the k-gate has
never passed — no human marks existed before this cycle), so nothing here
fires learner evidence; the human marks recorded afterwards are the
authoritative step. Idempotent: already-marked answers are skipped by the
server. Writes a JSON outcome artifact.
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
OUT_PATH = os.environ.get("RESULT_PATH", "s2-smartmark-result.json")


def http(method, path, token=None, payload=None, timeout=900):
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

    s, queue = http("GET", "/api/v1/teacher/marking/queue-v2?state=PENDING",
                    token=tok, timeout=300)
    if s != 200:
        print(f"FAIL queue-v2 status={s}")
        return 1
    groups = queue.get("groups") or []
    items = queue.get("items") or []
    by_paper: dict[str, list[str]] = {}
    for it in items:
        by_paper.setdefault(it.get("paperId"), []).append(
            it["answer"]["answerId"])
    print(f"queue: {len(items)} pending over {len(groups)} groups")

    result = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "groups": [], "totals": {}}
    marked = skipped = failed = 0
    for g in groups:
        pid = g.get("paperId")
        ids = by_paper.get(pid, [])
        if not ids:
            continue
        # the batch endpoint is bounded at 50 — groups here are <= 33
        s, batch = http("POST", "/api/v1/teacher/marking/smart-mark-batch",
                        token=tok, payload={"answerIds": ids})
        if s != 200:
            result["groups"].append({"paperId": pid, "code": g.get("paperCode"),
                                     "httpStatus": s})
            print(f"  {g.get('paperCode')}: batch status={s} (recorded, continuing)")
            continue
        rows = batch.get("items") or []
        g_marked = sum(1 for r in rows if r.get("outcome") == "MARKED")
        g_skip = sum(1 for r in rows if r.get("outcome") == "SKIPPED_ALREADY_MARKED")
        g_fail = sum(1 for r in rows if r.get("outcome") == "FAILED")
        marked += g_marked
        skipped += g_skip
        failed += g_fail
        result["groups"].append({
            "paperId": pid, "code": g.get("paperCode"), "httpStatus": s,
            "requested": batch.get("requested"), "marked": g_marked,
            "skipped": g_skip, "failed": g_fail,
            "failureReasons": sorted({str(r.get("reason")) for r in rows
                                      if r.get("outcome") == "FAILED"}),
        })
        print(f"  {g.get('paperCode')} ({g.get('sessionLabel')}): "
              f"marked={g_marked} skipped={g_skip} failed={g_fail}")

    result["totals"] = {"marked": marked, "skipped": skipped, "failed": failed}
    result["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1, sort_keys=True)
    print(f"smart-mark assist totals: marked={marked} skipped={skipped} "
          f"failed={failed} -> {OUT_PATH}")
    # honest exit: failures are recorded, not hidden; the human-mark phase
    # proceeds regardless (smart mark is an assist, not a gate)
    return 0


if __name__ == "__main__":
    sys.exit(main())
