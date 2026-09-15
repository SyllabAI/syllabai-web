#!/usr/bin/env python3
"""Sprint-2 §6/§7 production verification — the marking-throughput lane and
review-queue intelligence.

Runs from GitHub Actions (web repo, workflow_dispatch) with the PILOT_TEACHER_*
secrets — the same sanctioned pattern as the census, monitor, class probe and
V20 battery. Read-only against learner data: only GET endpoints plus ONE
zero-mutation batch call (an unknown answer id → honest FAILED item, nothing
marked). Prints counts (never secrets), writes the JSON snapshot artifact.

Verifies, against PRODUCTION:
  deploy        the §6/§7 surface exists (queue-v2, throughput, review-queue-v3,
                smart-mark-batch) — a 404 means Render has not picked up the
                new deploy yet
  queue-v2      paper groups contiguous in the item list, oldest-waiting paper
                first, the mark→next chain links item i to item i+1 (null on
                the last item only), every item carries the requested state
  throughput    all four marking states reported (honest zeros allowed),
                human-mark windows are numbers, pending-by-paper bounded,
                oldest pending age present when pending > 0
  queue-v3      every paper carries rankReasons; signal bounds hold
                (questionsWithScheme ≤ totalQuestions, mappedQuestions ≤
                totalQuestions, novelTopicCount ≥ 0); deterministic order on
                a second read
  batch         an unknown answer id returns a per-item FAILED outcome — the
                endpoint is live and honest, and NOTHING was marked

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 s2_marking_probe.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("BACKEND_URL", "https://syllabai-core.onrender.com").rstrip("/")
TEACHER_EMAIL = os.environ.get("TEACHER_EMAIL", "")
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")
OUT_PATH = os.environ.get("PROBE_PATH", "s2-marking-probe.json")


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

    # ── queue-v2 (the deterministic paper-grouped marking queue) ──────
    s, queue = http("GET", "/api/v1/teacher/marking/queue-v2?state=PENDING", token=tok)
    if s != 200:
        print(f"FAIL marking queue-v2 status={s} (deploy current?)")
        return 1
    items = queue.get("items") or []
    groups = queue.get("groups") or []

    # state honesty: only PENDING rows in the PENDING queue
    wrong_state = [i["answer"]["answerId"] for i in items
                   if i["answer"].get("markingState") != "PENDING"]
    if wrong_state:
        failures.append(f"non-PENDING rows in PENDING queue: {len(wrong_state)}")

    # group contiguity: items of each paper are adjacent
    paper_switches = 0
    prev_paper = None
    for i in items:
        pid = i.get("paperId")
        if pid != prev_paper:
            paper_switches += 1
            prev_paper = pid
    if paper_switches > max(len(groups), 1):
        failures.append(f"groups not contiguous: {paper_switches} switches over "
                        f"{len(groups)} groups")

    # oldest-waiting paper first
    oldest = [g.get("oldestPendingAt") for g in groups if g.get("oldestPendingAt")]
    if len(oldest) > 1 and oldest != sorted(oldest):
        failures.append("paper groups not oldest-waiting-first")

    # the mark→next chain: item i.next == item i+1.answerId, last is null
    for idx, i in enumerate(items):
        expect = items[idx + 1]["answer"]["answerId"] if idx + 1 < len(items) else None
        if i.get("nextAnswerId") != expect:
            failures.append(f"mark→next chain broken at index {idx}")
            break
    if items and items[-1].get("nextAnswerId") is not None:
        failures.append("last queue item still points at a next answer")

    snapshot["markingQueueV2"] = {
        "state": queue.get("state"),
        "groups": [
            {"paperId": g.get("paperId"), "title": g.get("paperTitle"),
             "code": g.get("paperCode"), "count": g.get("count"),
             "oldestPendingAt": g.get("oldestPendingAt"),
             "oldestWaitingHours": g.get("oldestWaitingHours")}
            for g in groups[:10]],
        "items": len(items),
    }
    print(f"queue-v2 OK: {len(items)} pending over {len(groups)} paper group(s), "
          f"chain OK, groups contiguous, oldest-first")

    # determinism: a second read returns the same order
    s2, queue2 = http("GET", "/api/v1/teacher/marking/queue-v2?state=PENDING", token=tok)
    if s2 == 200:
        order1 = [i["answer"]["answerId"] for i in items]
        order2 = [i["answer"]["answerId"] for i in (queue2.get("items") or [])]
        if order1 != order2:
            failures.append("queue-v2 ordering not deterministic across reads")
    else:
        failures.append(f"queue-v2 second read status={s2}")

    # ── throughput (counts of what happened) ──────────────────────────
    s, tp = http("GET", "/api/v1/teacher/marking/throughput", token=tok)
    if s != 200:
        failures.append(f"throughput status={s}")
    else:
        by_state = tp.get("answersByState") or {}
        for state in ("PENDING", "SMART_MARKED", "HUMAN_MARKED", "OVERRIDDEN"):
            if not isinstance(by_state.get(state), int):
                failures.append(f"throughput missing state {state}")
        leaders = tp.get("pendingByPaper") or []
        if len(leaders) > 5:
            failures.append(f"pending-by-paper leaders unbounded: {len(leaders)}")
        pending = by_state.get("PENDING", 0)
        if pending > 0 and tp.get("oldestPendingAt") is None:
            failures.append("pending > 0 but no oldest pending age")
        snapshot["throughput"] = {
            "answersByState": by_state,
            "humanMarks24h": tp.get("humanMarks24h"),
            "humanMarks7d": tp.get("humanMarks7d"),
            "pendingByPaper": [
                {"paperId": p.get("paperId"), "pending": p.get("pending")}
                for p in leaders],
            "oldestPendingHours": tp.get("oldestPendingHours"),
        }
        print(f"throughput OK: states={by_state} "
              f"human24h={tp.get('humanMarks24h')} 7d={tp.get('humanMarks7d')} "
              f"oldestPending={tp.get('oldestPendingHours')}h")

    # ── review-queue-v3 (§7 queue intelligence) ────────────────────────
    s, v3 = http("GET", "/api/v1/teacher/content/review-queue-v3", token=tok)
    if s != 200:
        failures.append(f"review-queue-v3 status={s} (deploy current?)")
    else:
        papers = v3.get("papers") or []
        for p in papers:
            total = p.get("totalQuestions") or 0
            if not isinstance(p.get("rankReasons"), list):
                failures.append(f"paper {p.get('id')} missing rankReasons")
                break
            if total > 0 and (p.get("questionsWithScheme", 0) > total
                              or p.get("mappedQuestions", 0) > total):
                failures.append(f"paper {p.get('id')} signals exceed question census")
                break
            if (p.get("novelTopicCount") or 0) < 0:
                failures.append(f"paper {p.get('id')} negative novel coverage")
                break
        # determinism: same first ids on a second read
        s2b, v3b = http("GET", "/api/v1/teacher/content/review-queue-v3", token=tok)
        if s2b == 200:
            ids1 = [p.get("id") for p in papers[:15]]
            ids2 = [p.get("id") for p in (v3b.get("papers") or [])[:15]]
            if ids1 != ids2:
                failures.append("review-queue-v3 ordering not deterministic")
        else:
            failures.append(f"review-queue-v3 second read status={s2b}")

        fully_schemed = sum(1 for p in papers
                            if (p.get("totalQuestions") or 0) > 0
                            and p.get("questionsWithScheme") == p.get("totalQuestions"))
        with_novel = sum(1 for p in papers if (p.get("novelTopicCount") or 0) > 0)
        snapshot["reviewQueueV3"] = {
            "papers": len(papers),
            "suggestedVersions": v3.get("suggestedVersions"),
            "suggestedSchemes": v3.get("suggestedSchemes"),
            "practicableTopicCount": v3.get("practicableTopicCount"),
            "fullySchemedPapers": fully_schemed,
            "papersWithNovelTopics": with_novel,
            "topReasons": (papers[0].get("rankReasons") if papers else []),
        }
        print(f"queue-v3 OK: {len(papers)} suggested papers, "
              f"{fully_schemed} fully schemed, {with_novel} with novel topics, "
              f"practicable={v3.get('practicableTopicCount')}")

    # ── the batch endpoint is live and honest — with ZERO mutation ─────
    unknown = str(uuid.uuid4())
    s, batch = http("POST", "/api/v1/teacher/marking/smart-mark-batch",
                    token=tok, payload={"answerIds": [unknown]})
    if s != 200:
        failures.append(f"smart-mark-batch status={s}")
    else:
        rows = batch.get("items") or []
        if len(rows) != 1 or rows[0].get("outcome") != "FAILED":
            failures.append("unknown answer id did not produce an honest FAILED item")
        else:
            print(f"batch OK: unknown id → {rows[0].get('outcome')} "
                  f"({rows[0].get('reason')}) — nothing marked")
        snapshot["batchZeroMutation"] = {
            "requested": batch.get("requested"),
            "marked": batch.get("marked"),
            "failed": batch.get("failed"),
            "skipped": batch.get("skipped"),
            "reason": rows[0].get("reason") if rows else None,
        }

    snapshot["failures"] = failures
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=1, sort_keys=True)
    if failures:
        print(f"FAIL invariants: {failures}")
        return 1
    print("marking-throughput + queue-intelligence production probe: ALL OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
