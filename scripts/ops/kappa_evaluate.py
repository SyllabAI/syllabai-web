#!/usr/bin/env python3
"""Run the Smart Mark κ agreement evaluation against production (F-161).

Runs from GitHub Actions (web repo, workflow_dispatch) with the PILOT_TEACHER_*
secrets — the same sanctioned pattern as the census, monitor, class probe and
marking probe. UNLIKE those read-only probes this one WRITES exactly one row:
POST /api/v1/teacher/marking/kappa/evaluate persists a new
smart_mark_agreement_evaluations record (scope ALL when no paperId is sent).
Re-running is the calibration ritual — dispatch again after a marking round
to refresh the gate on the accumulated dual-marked pairs.

What it does:
  1. waits for the backend to be healthy (free-tier cold start tolerated)
  2. logs in as the pilot teacher
  3. POST /api/v1/teacher/marking/kappa/evaluate  ({} — global scope)
  4. GET  /api/v1/teacher/marking/kappa/latest    (verify the row persisted)
  5. prints sample/κ/observed/threshold/passed and writes the JSON artifact

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 kappa_evaluate.py
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
OUT_PATH = os.environ.get("OUT_PATH", "kappa-evaluation.json")


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
            return e.code, json.loads(body)
        except Exception:
            return e.code, body


def wait_healthy(max_wait_s: int = 300) -> bool:
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        status, _ = http("GET", "/actuator/health", timeout=30)
        if status == 200:
            return True
        time.sleep(10)
    return False


def main() -> int:
    if not TEACHER_EMAIL or not TEACHER_PASSWORD:
        print("FAIL: TEACHER_EMAIL/TEACHER_PASSWORD not set")
        return 1

    result = {"backend": BASE}

    if not wait_healthy():
        print("FAIL: backend did not become healthy within 300 s")
        return 1
    result["health"] = "UP"

    status, body = http("POST", "/api/v1/auth/login",
                        payload={"email": TEACHER_EMAIL, "password": TEACHER_PASSWORD})
    if status != 200 or not body or not body.get("accessToken"):
        print(f"FAIL login ({status}): {body}")
        return 1
    token = body["accessToken"]
    roles = (body.get("user") or {}).get("roles") or body.get("roles")
    print(f"login OK (roles={roles})")

    # the evaluation — scope omitted = ALL (TeacherMarkingController contract)
    status, body = http("POST", "/api/v1/teacher/marking/kappa/evaluate",
                        token=token, payload={})
    print(f"POST /kappa/evaluate -> {status}")
    print(json.dumps(body, indent=2))
    if status != 201:
        print("FAIL: evaluation not created (see body above — 409 means no "
              "paired smart/human mark-point decisions are available)")
        result["evaluate"] = {"status": status, "body": body}
        with open(OUT_PATH, "w") as f:
            json.dump(result, f, indent=2, default=str)
        return 1
    result["evaluate"] = body

    # persistence check through the read model
    status, latest = http("GET", "/api/v1/teacher/marking/kappa/latest", token=token)
    print(f"GET /kappa/latest -> {status}")
    print(json.dumps(latest, indent=2))
    result["latest"] = latest if status == 200 else {"status": status, "body": latest}

    if status == 200 and latest.get("id") == body.get("id"):
        print(f"VERIFIED: evaluation {body['id']} persisted — "
              f"sample={body['sampleSize']} kappa={body['kappa']} "
              f"threshold={body['threshold']} passed={body['passed']}")
        with open(OUT_PATH, "w") as f:
            json.dump(result, f, indent=2, default=str)
        return 0
    print("FAIL: latest evaluation does not match the one just computed")
    with open(OUT_PATH, "w") as f:
        json.dump(result, f, indent=2, default=str)
    return 1


if __name__ == "__main__":
    sys.exit(main())
