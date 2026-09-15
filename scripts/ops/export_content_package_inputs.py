#!/usr/bin/env python3
"""Export REAL canonical validated content for the Content Package v0.1 proof.

Runs from GitHub Actions (web repo, workflow_dispatch) with the PILOT_TEACHER_*
secrets — the same sanctioned pattern as the V20 battery. Produces one JSON
export of:

  positive case   one fully-VALIDATED 4CH1 paper (every question version has a
                  VALIDATED mark scheme = complete marking contract): full
                  teacher review view (answer key included), the ingestion
                  provenance record (deterministic parser document ids + source
                  QP/MS checksums) and per-question topic rows (ingestion
                  anchor + real curriculum mapping)
  negative case   one SUGGESTED scheme-less paper (review view only, for the
                  fail-closed compiler cases)

Secrets are NEVER printed; the export carries content data only. The JSON is
uploaded as a workflow artifact AND summarized to the log (ids + counts).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("BACKEND_URL", "https://syllabai-core.onrender.com").rstrip("/")
TEACHER_EMAIL = os.environ.get("TEACHER_EMAIL", "")
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")

OUT_PATH = os.environ.get("EXPORT_PATH", "content-package-export.json")


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
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body or "null")
        except Exception:
            return e.code, {"raw": body[:300]}


def main() -> int:
    assert TEACHER_EMAIL and TEACHER_PASSWORD, "PILOT_TEACHER_* must be set"

    s, login = http("POST", "/api/v1/auth/login",
                    payload={"email": TEACHER_EMAIL, "password": TEACHER_PASSWORD})
    tok = login.get("accessToken") if isinstance(login, dict) else None
    if s != 200 or not tok:
        print(f"FAIL teacher login status={s}")
        return 1
    print(f"PASS teacher login status={s}")

    # ── choose the positive case: one fully-VALIDATED paper ──────────────
    s, papers = http("GET", "/api/v1/exam-papers", token=tok)
    if s != 200:
        print(f"FAIL papers list status={s}")
        return 1
    validated = [p for p in papers if p.get("validationState") == "VALIDATED"]
    print(f"census total={len(papers)} validated={len(validated)}")
    if not validated:
        print("FAIL no VALIDATED paper available")
        return 1
    # deterministic choice: newest fully-validated paper that ALSO has an
    # ingestion provenance record. Campaign-imported papers legitimately lack
    # documents rows (the provenance endpoint fail-closes 404 for them); the
    # export needs a provenanced positive case, so those are skipped — never
    # manufactured around.
    positive = None
    skipped_unprovenanced = 0
    for p in sorted(validated, key=lambda p: (p.get("createdAt") or ""), reverse=True):
        pid_try = p["id"]
        sp, prov_try = http("GET",
                            f"/api/v1/teacher/content/exam-papers/{pid_try}/provenance",
                            token=tok)
        if sp == 200 and isinstance(prov_try, dict):
            positive = p
            break
        skipped_unprovenanced += 1
    if positive is None:
        print("FAIL no VALIDATED paper with provenance available — refusing to "
              "export an unprovenanced positive case")
        return 1
    if skipped_unprovenanced:
        print(f"selection skipped {skipped_unprovenanced} unprovenanced validated paper(s)")
    pid = positive["id"]
    print(f"positive paper id={pid} title={positive.get('title')!r} code={positive.get('paperCode')!r}")

    s, review = http("GET", f"/api/v1/teacher/content/exam-papers/{pid}/review", token=tok)
    if s != 200:
        print(f"FAIL paper review status={s}")
        return 1
    versions = review.get("versions", [])
    schemeless = [v for v in versions if not v.get("schemeId")]
    not_validated_scheme = [
        v for v in versions if v.get("schemeId") and v.get("schemeState") != "VALIDATED"]
    print(f"review versions={len(versions)} schemeless={len(schemeless)} "
          f"schemeNotValidated={len(not_validated_scheme)}")
    if schemeless or not_validated_scheme:
        print("FAIL chosen paper does not have a complete marking contract — refusing")
        return 1

    s, provenance = http("GET", f"/api/v1/teacher/content/exam-papers/{pid}/provenance", token=tok)
    prov_ok = bool(
        s == 200 and isinstance(provenance, dict)
        and (provenance.get("questionPaper") or {}).get("checksum")
        and (provenance.get("markScheme") or {}).get("checksum"))
    print(f"{'PASS' if prov_ok else 'FAIL'} provenance status={s} "
          f"qp={((provenance or {}).get('questionPaper') or {}).get('checksum', 'unset')[:16]} "
          f"ms={((provenance or {}).get('markScheme') or {}).get('checksum', 'unset')[:16]}")

    topic_rows = {}
    for v in versions:
        qid = v.get("questionId")
        s, rows = http("GET", f"/api/v1/teacher/content/questions/{qid}/topics", token=tok)
        if s == 200:
            topic_rows[qid] = rows
    anchors = sum(1 for rows in topic_rows.values()
                  if any(r.get("code", "").startswith("ING-") for r in (rows or [])))
    mapped = sum(1 for rows in topic_rows.values()
                 if any(r.get("primary") and not r.get("code", "").startswith("ING-")
                        for r in (rows or [])))
    print(f"topic rows questions={len(topic_rows)} withAnchor={anchors} withCurriculumPrimary={mapped}")

    if not prov_ok:
        print("FAIL provenance unavailable — refusing to export an unprovenanced positive case")
        return 1

    export = {
        "exportSchema": "syllabai-content-package-inputs/1.0",
        "capturedAt": positive.get("createdAt"),
        "positiveCase": {
            "papersListItem": positive,
            "review": review,
            "provenance": provenance,
            "topicRows": topic_rows,
        },
        "notes": {
            "selectionRule": "newest paper with validationState=VALIDATED, a complete "
                             "marking contract (every version has a VALIDATED scheme) AND "
                             "an ingestion provenance record (unprovenanced validated "
                             "papers are skipped, never manufactured around)",
            "servingProof": "papers in this state are learner-servable (V20 battery B12)",
        },
    }

    # ── negative case: one SUGGESTED scheme-less paper ───────────────────
    s, queue = http("GET", "/api/v1/teacher/content/review-queue-v2", token=tok)
    if s == 200:
        candidates = [
            p for p in queue.get("papers", [])
            if p.get("versionCount", 0) > (p.get("validatedVersions", 0))
            and (p.get("versionCount", 0) - p.get("validatedVersions", 0)
                 - p.get("rejectedVersions", 0) - p.get("flaggedVersions", 0))
            > p.get("suggestedSchemes", 0)
        ]
        if candidates:
            neg = sorted(candidates, key=lambda p: p.get("versionCount", 0))[0]
            s2, neg_review = http(
                "GET", f"/api/v1/teacher/content/exam-papers/{neg['id']}/review", token=tok)
            if s2 == 200:
                nv = neg_review.get("versions", [])
                export["negativeCase"] = {
                    "queueSummary": neg,
                    "review": neg_review,
                    "schemelessVersionIds": [v["versionId"] for v in nv if not v.get("schemeId")],
                }
                print(f"negative paper id={neg['id']} title={neg.get('title')!r} "
                      f"schemeless={len(export['negativeCase']['schemelessVersionIds'])}")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(export, f, indent=2, sort_keys=True)
    size = os.path.getsize(OUT_PATH)
    print(f"export written path={OUT_PATH} bytes={size}")
    print("EXPORT DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
