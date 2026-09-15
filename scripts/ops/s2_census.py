#!/usr/bin/env python3
"""Sprint-2 §1 baseline census — read-only production state snapshot.

Runs from GitHub Actions (web repo, workflow_dispatch) with the PILOT_TEACHER_*
secrets — the same sanctioned pattern as the V20 battery and the pilot probe.
Collects ONLY read-only data over existing endpoints; prints statuses and
counts (never secrets) and writes the JSON snapshot for the workflow artifact.

Snapshot contents (all read-only):
  papers            exam-papers census by validation state (overall + 4CH1)
  review-queue      SUGGESTED papers / versions / schemes (+ v2 enrichment)
  serving           4CH1 scoped servable question count (learner boundary)
  concept-graph     teacher KG edges: total + by kind + validated count
  roster            enabled STUDENT cohort size
  marking           marking queue by state (structured evidence activity)
  smart-lesson      one Smart Lesson read as a fresh disposable learner is NOT
                    performed here (the pilot probe owns that surface); this
                    census records teacher-side state only.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 s2_census.py
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
OUT_PATH = os.environ.get("CENSUS_PATH", "s2-census.json")


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

    snap: dict = {"capturedAtUTC": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    # ── subjects (id ↔ code map) ─────────────────────────────────────────
    s, subjects = http("GET", "/api/v1/curriculum/subjects", token=tok)
    if s != 200 or not isinstance(subjects, list):
        print(f"FAIL subjects status={s}")
        return 1
    by_id = {x["id"]: x for x in subjects if isinstance(x, dict) and "id" in x}
    ch1 = next((x for x in subjects if x.get("code") == "4CH1"), None)
    snap["subjects"] = [{"code": x.get("code"), "rooted": bool(x.get("knowledgeNodeId"))}
                        for x in subjects]
    print(f"subjects={len(subjects)} rooted="
          f"{sum(1 for x in subjects if x.get('knowledgeNodeId'))}")

    # ── papers census ────────────────────────────────────────────────────
    s, papers = http("GET", "/api/v1/exam-papers", token=tok)
    if s != 200 or not isinstance(papers, list):
        print(f"FAIL papers status={s}")
        return 1
    def _census(rows):
        out: dict[str, int] = {}
        for p in rows:
            st = p.get("validationState", "?")
            out[st] = out.get(st, 0) + 1
        return dict(sorted(out.items()))
    snap["papersAll"] = _census(papers)
    ch1_papers = [p for p in papers if by_id.get(p.get("subjectId"), {}).get("code") == "4CH1"]
    snap["papers4CH1"] = _census(ch1_papers)
    snap["papersTotal"] = len(papers)
    print(f"papers total={len(papers)} all={snap['papersAll']} 4CH1={snap['papers4CH1']}")

    # ── review queue (SUGGESTED workload) ────────────────────────────────
    s, queue = http("GET", "/api/v1/teacher/content/review-queue", token=tok)
    if s == 200 and isinstance(queue, dict):
        snap["reviewQueue"] = {
            "suggestedPapers": len(queue.get("papers", [])),
            "suggestedVersions": queue.get("suggestedVersions"),
            "suggestedSchemes": queue.get("suggestedSchemes"),
        }
        print(f"review-queue {snap['reviewQueue']}")
    else:
        print(f"WARN review-queue status={s}")

    s, q2 = http("GET", "/api/v1/teacher/content/review-queue-v2", token=tok)
    if s == 200 and isinstance(q2, dict):
        enriched = q2.get("papers", [])
        reconciled = sum(1 for p in enriched if p.get("reconciliationStatus") == "OK")
        with_conf = [p for p in enriched if p.get("avgExtractionConfidence") is not None]
        snap["reviewQueueV2"] = {
            "papers": len(enriched),
            "reconciliationOK": reconciled,
            "papersWithConfidence": len(with_conf),
            "meanConfidence": round(
                sum(p["avgExtractionConfidence"] for p in with_conf) / len(with_conf), 4)
            if with_conf else None,
        }
        print(f"review-queue-v2 {snap['reviewQueueV2']}")

    # ── serving boundary (learner view of 4CH1) ──────────────────────────
    if ch1 and ch1.get("knowledgeNodeId"):
        s, served = http("GET",
                         f"/api/v1/questions?rootId={ch1['knowledgeNodeId']}", token=tok)
        n = len(served) if isinstance(served, list) else -1
        mapped = sum(1 for q in (served or [])
                     if isinstance(q, dict) and q.get("primaryTopicNodeId"))
        snap["serving4CH1"] = {"questions": n, "withPrimaryTopic": mapped}
        print(f"serving 4CH1 questions={n} withPrimaryTopic={mapped}")

    # ── concept graph (teacher KG, scoped to the 4CH1 root) ──────────────
    if ch1 and ch1.get("knowledgeNodeId"):
        s, cg = http("GET",
                     f"/api/v1/teacher/concept-graph/edges?rootId={ch1['knowledgeNodeId']}",
                     token=tok)
        if s == 200 and isinstance(cg, dict):
            edges = cg.get("edges", [])
            relations: dict[str, int] = {}
            states: dict[str, int] = {}
            for e in edges:
                if not isinstance(e, dict):
                    continue
                k = e.get("relation") or "?"
                relations[k] = relations.get(k, 0) + 1
                st = e.get("validationStatus") or "?"
                states[st] = states.get(st, 0) + 1
            snap["conceptGraph"] = {"policy": cg.get("policy"), "edges": len(edges),
                                    "byRelation": relations, "byState": states}
            print(f"concept-graph edges={len(edges)} relations={relations} states={states}")
        else:
            print(f"WARN concept-graph status={s}")

    # ── roster (enabled STUDENT cohort) ──────────────────────────────────
    s, roster = http("GET", "/api/v1/teacher/learners", token=tok)
    if s == 200 and isinstance(roster, list):
        snap["roster"] = {"learners": len(roster)}
        print(f"roster learners={len(roster)}")
    else:
        print(f"WARN roster status={s}")

    # ── marking queue (structured evidence activity) ─────────────────────
    marking: dict[str, int] = {}
    for state in ("PENDING", "SMART_MARKED", "HUMAN_MARKED", "OVERRIDDEN"):
        s, answers = http("GET", f"/api/v1/teacher/marking/answers?state={state}", token=tok)
        if s == 200 and isinstance(answers, list):
            marking[state] = len(answers)
        else:
            marking[state] = -1
    snap["markingQueue"] = marking
    print(f"marking queue {marking}")

    # ── audit trail durability (V22): audit rows on the most recently
    #    mutated papers are per-paper; the aggregate surface ships with the
    #    class-analytics work. Record a probe: the audit endpoint exists and
    #    fail-closes for an unknown paper id.
    fake = "00000000-0000-0000-0000-00000000c0de"
    s, _ = http("GET", f"/api/v1/teacher/content/exam-papers/{fake}/audit", token=tok)
    snap["auditEndpointUnknownPaperStatus"] = s
    print(f"audit endpoint unknown-paper status={s} (expect 404)")

    with open(OUT_PATH, "w") as f:
        json.dump(snap, f, indent=2, sort_keys=True)
    print(f"census written to {OUT_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
