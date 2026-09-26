#!/usr/bin/env python3
"""T-C30 — operator-directed KG-tree applicability backfill activation.

T-C24 (core 3c1600c) merged the seed-side idempotent backfill: on the next
re-activation, ConceptGraphSeedService.resolveNode's content-equality guard
writes the official paper/unit/tier scope onto the already-seeded spec-point
rows, verbatim from the SHA-pinned 4CH1 snapshot (zero invention, single
transaction, fail-closed on any provenance mismatch). The only automated
actor that ever called the activation endpoint (the pilot monitor) was
retired, so the backfill never fired — prod's 374 4CH1 nodes carry null
applicability (T-C28 sweep, 2026-09-26). The operator directive to run it is
recorded in coordination task T-C30 (session web-98866c45, 2026-09-26).

This script performs the sanctioned activation and verifies it honestly:

  health      cold-start tolerant (3 attempts; the instance wakes on first hit)
  activate    POST /api/v1/teacher/concept-graph/activate (teacher token,
              300 s timeout per the pilot_probe.py recovery note — the
              re-activation re-validates the whole 340-node seed). Prints the
              SeedSummary counts; nodesCreated/edgesCreated > 0 is reported as
              DRIFT (tree/snapshot divergence), not silently ignored. The
              backfill write count itself is LOG-ONLY on core (T-C24 contract:
              SeedSummary must not grow) — hence the student-side check below.
  verify      with PILOT_MONITOR_* secrets (the TEST learner account, read-only):
              GET the 4CH1 learner knowledge graph before and after and count
              nodes whose applicability is non-null. Pre-activation the count
              is 0 (T-C28 sweep); post-activation it must be > 0 (182
              spec-point nodes expected). Without the secrets this check is
              skipped honestly and the caller verifies out-of-band.

Idempotent by construction: a second run writes 0 additional values (the
content-equality guard sees equal maps). Read-only printing, never echoes
credentials, JSON snapshot for the workflow artifact.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... [MONITOR_EMAIL=... MONITOR_PASSWORD=...]
       python3 tc30_concept_graph_activate.py
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
MONITOR_EMAIL = os.environ.get("MONITOR_EMAIL", "")
MONITOR_PASSWORD = os.environ.get("MONITOR_PASSWORD", "")
OUT_PATH = os.environ.get("PROBE_PATH", "tc30-activation.json")


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


def login(email: str, password: str, label: str):
    s, body = http("POST", "/api/v1/auth/login",
                   payload={"email": email, "password": password}, timeout=180)
    tok = body.get("accessToken") if isinstance(body, dict) else None
    if s != 200 or not tok:
        print(f"FAIL {label} login status={s}")
        return None
    print(f"{label} login OK")
    return tok


def kg_applicability_count(token: str):
    """Read-only: walk the 4CH1 learner KG and count non-null applicability."""
    s, subjects = http("GET", "/api/v1/curriculum/subjects", token=token)
    if s != 200 or not isinstance(subjects, list):
        return {"error": f"subjects status={s}"}
    sub = next((x for x in subjects
                if x.get("code") == "4CH1" and x.get("knowledgeNodeId")), None)
    if sub is None:
        return {"error": "no 4CH1 subject with a knowledgeNodeId"}
    s, kg = http("GET", f"/api/v1/learners/me/knowledge-graph?rootId={sub['knowledgeNodeId']}",
                 token=token, timeout=180)
    if s != 200 or not isinstance(kg, dict) or not isinstance(kg.get("nodes"), list):
        return {"error": f"knowledge-graph status={s}"}
    nodes = kg["nodes"]
    non_null = sum(1 for n in nodes
                   if isinstance(n, dict) and n.get("applicability") is not None)
    missing = sum(1 for n in nodes
                  if not isinstance(n, dict) or "applicability" not in n)
    return {"rootCode": kg.get("rootCode"), "nodes": len(nodes),
            "nonNullApplicability": non_null, "missingApplicabilityKey": missing}


def main() -> int:
    assert TEACHER_EMAIL and TEACHER_PASSWORD, "PILOT_TEACHER_* must be set"
    snapshot: dict = {"task": "T-C30", "base": BASE}

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

    teacher_tok = login(TEACHER_EMAIL, TEACHER_PASSWORD, "teacher")
    if teacher_tok is None:
        return 1

    # pre-state via the TEST learner account (read-only), when provisioned
    if MONITOR_EMAIL and MONITOR_PASSWORD:
        mon_tok = login(MONITOR_EMAIL, MONITOR_PASSWORD, "monitor learner")
        if mon_tok is not None:
            pre = kg_applicability_count(mon_tok)
            snapshot["preActivation"] = pre
            print(f"pre-activation learner KG: {json.dumps(pre)}")
        else:
            snapshot["preActivation"] = {"skipped": "monitor login failed"}
    else:
        snapshot["preActivation"] = {"skipped": "PILOT_MONITOR_* not set"}

    # the activation itself — 300 s: re-activation re-validates the whole seed
    # (pilot_probe.py recovery 2026-09-13 measured 60–120 s on the 0.1-CPU tier)
    s, summary = http("POST", "/api/v1/teacher/concept-graph/activate",
                      token=teacher_tok, timeout=300)
    snapshot["activationStatus"] = s
    snapshot["seedSummary"] = summary if isinstance(summary, dict) else {"raw": str(summary)[:300]}
    if s != 200:
        print(f"FAIL activation status={s} {json.dumps(summary)[:200] if summary else ''}")
        write_snapshot(snapshot)
        return 1
    nc = summary.get("nodesCreated") if isinstance(summary, dict) else None
    ec = summary.get("edgesCreated") if isinstance(summary, dict) else None
    print(f"activation 200 — SeedSummary: {json.dumps(summary)}")
    if nc or ec:
        # not fatal (a legitimately missing node would be created by the
        # idempotent seed), but it is tree/snapshot drift the operator sees
        print(f"WARN drift: activation created {nc} nodes / {ec} edges — "
              f"prod tree diverged from the pinned snapshot")
        snapshot["drift"] = {"nodesCreated": nc, "edgesCreated": ec}

    # post-state verification
    verdict = "ACTIVATION OK — student-side verification SKIPPED (PILOT_MONITOR_* not set)"
    exit_code = 0
    if MONITOR_EMAIL and MONITOR_PASSWORD:
        mon_tok = login(MONITOR_EMAIL, MONITOR_PASSWORD, "monitor learner")
        if mon_tok is not None:
            post = kg_applicability_count(mon_tok)
            snapshot["postActivation"] = post
            print(f"post-activation learner KG: {json.dumps(post)}")
            n = post.get("nonNullApplicability")
            if isinstance(n, int) and n > 0:
                verdict = f"ACTIVATION VERIFIED — applicability present on {n} node(s)"
            else:
                verdict = "ACTIVATION NOT VERIFIED — learner KG still carries null applicability"
                exit_code = 1
    write_snapshot(snapshot)
    print(verdict)
    return exit_code


def write_snapshot(snapshot: dict) -> None:
    with open(OUT_PATH, "w") as f:
        json.dump(snapshot, f, indent=2)
    print(f"snapshot written -> {OUT_PATH}")


if __name__ == "__main__":
    sys.exit(main())
