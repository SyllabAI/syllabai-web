#!/usr/bin/env python3
"""V20 production verification battery — TEACHER side.

Runs from GitHub Actions (web repo, workflow_dispatch) against the deployed
Render backend with the PILOT_TEACHER_* secrets. Verifies, on the LIVE
deployment:
  B1  teacher login + role
  B2  bootstrap window closed (available=false, claim POST refused)
  B3  teacher blocked from /api/v1/admin/** (403)
  B4  student blocked from /api/v1/teacher/** (403)
  B5  review-queue-v2 census (SUGGESTED papers + versions)
  per paper (TARGET_COUNT papers, smallest-first, distinct sessions):
  B6  paper review header (subjectId placement context) + teacher-only answer key
  B7  FLAGGED version blocks batch validate-all (409, fail-closed)
  B9  paper validate before versions validated (409 rule)
  B11 batch validate-all -> paper VALIDATED (versions + schemes in one call)
  B12 student sees the paper VALIDATED and can attempt it (201 PENDING)
  B13 PAPER-level FLAGGED gate: flagged paper stops serving VALIDATED versions
      (student attempt 404) and blocks batch validation (409)
  B14 unflag -> per-version rule resumes (attempt 201 again) -> re-validate
  B16 VERSION-level gate: flag -> 404, unflag -> 404, re-validate -> 201
  once (first paper):
  B17 topic mapping: anchor rows visible (incl. synthesized ING- anchor);
      anchor-as-primary refused (409); remap onto a real curriculum topic;
      re-map to the SAME node (the uq_question_topic flush regression,
      80b1ff8) stays 200
  B18 final census delta

The battery is self-consistent: every target paper ends fully VALIDATED (that
is the intended dogfood outcome) and every flag/unflag cycle it opens is
closed. Secrets are NEVER printed; logs carry statuses, ids and counts only.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... [TARGET_COUNT=3] \\
       python3 v20_battery.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from random import randint

BASE = os.environ.get("BACKEND_URL", "https://syllabai-core.onrender.com").rstrip("/")
TEACHER_EMAIL = os.environ.get("TEACHER_EMAIL", "")
TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")
STUDENT_EMAIL = (
    f"v20.battery.{int(time.time())}.{randint(100, 999)}@syllabai-test.dev")
STUDENT_PW = "v20-battery-passphrase-" + str(randint(100000, 999999))
# Representative dogfood set: 1 = deep verification only (default);
# N = run the whole per-paper sequence on the N smallest distinct papers.
TARGET_COUNT = int(os.environ.get("TARGET_COUNT", "1"))

RESULTS: list[tuple[str, bool, str]] = []


def http(method, path, token=None, payload=None, timeout=90):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                return r.status, json.loads(raw)
            except json.JSONDecodeError:
                return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


def wait_backend(seconds=150):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            c, body = http("GET", "/actuator/health", timeout=15)
            if c == 200 and isinstance(body, dict) and body.get("status") == "UP":
                return True
        except Exception:
            pass
        time.sleep(8)
    return False


def all_topics(node, acc):
    acc.append(node)
    for kid in node.get("children") or []:
        all_topics(kid, acc)
    return acc


def pick_real_topic(tree):
    """First non-anchor curriculum node with a spec-style code (1.x–5.x)."""
    cands = [n for n in all_topics(tree, [])
             if (n.get("code") or "").startswith(("1.", "2.", "3.", "4.", "5."))]
    return cands[0] if cands else None


def structured_attempt(S, qid, parts, text="battery probe"):
    payload = {"questionId": qid,
               "partAnswers": [{"partId": p["id"], "answerText": text}
                               for p in parts],
               "responseTimeMs": 8000, "confidence": 3,
               "selfDoubtFlag": False, "timedCondition": False}
    return http("POST", "/api/v1/attempts/structured", token=S, payload=payload)


def student_parts(S, qid):
    c, qv = http("GET", f"/api/v1/questions/{qid}", token=S)
    if isinstance(qv, dict):
        return (qv or {}).get("parts") or []
    return []


def battery_for_paper(T, S, target, hdr_subject_fallback, first):
    """The full per-paper verification sequence. Returns nothing; records checks."""
    tid = target["id"]
    tag = f"[{target.get('sessionLabel') or target.get('title')}]"
    print(f"target paper: {tid} {tag} versions={target.get('versionCount')} "
          f"bridge={target.get('reconciliationStatus')}", flush=True)

    # B6 review header + teacher answer key
    c, rv = http("GET", f"/api/v1/teacher/content/exam-papers/{tid}/review", token=T)
    hdr = rv.get("paper", {}) if isinstance(rv, dict) else {}
    vers = rv.get("versions", []) if isinstance(rv, dict) else []
    check(f"B6a {tag} review header has subjectId (§7 placement context)",
          c == 200 and hdr.get("subjectId") is not None,
          f"status={c} subjectId={str(hdr.get('subjectId'))[:8]}")
    schemeless = [v for v in vers if not v.get("schemeId")]
    teacher_sees_key = any(
        any(o.get("correct") for o in (v.get("options") or []))
        or (v.get("schemeId") and (v.get("points") or []))
        for v in vers)
    check(f"B6b {tag} teacher review shows the answer key", teacher_sees_key,
          f"versions={len(vers)} "
          f"withScheme={sum(1 for v in vers if v.get('schemeId'))}")

    # B11a marking-contract guard: scheme-less versions must block the paper
    # flip unless the reviewer explicitly forces it (§7; found live by this
    # battery — a June-2014 paper validated with 0 schemes and its attempts
    # could never be marked).
    if schemeless:
        c, e = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                    token=T)
        msg = str(e)
        check(f"B11a {tag} scheme-less versions block the flip (409, guard)",
              c == 409 and "mark scheme" in msg,
              f"status={c} msg={msg[:90]}")
        print(f"{tag} skipped: {len(schemeless)} scheme-less version(s) — the "
              f"guard held; a teacher must author schemes first", flush=True)
        return None, None

    v0 = vers[0] if vers else None
    v1 = vers[1] if len(vers) > 1 else None

    # B7 flagged version blocks the batch; B9 paper validate 409 rule
    if v0:
        c, _ = http("POST", f"/api/v1/teacher/content/question-versions/{v0['versionId']}/flag",
                    token=T)
        check(f"B7a {tag} flag version -> FLAGGED", c == 200, f"status={c}")
        c, e = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                    token=T)
        check(f"B7b {tag} batch blocked by FLAGGED version (409)", c == 409,
              f"status={c} msg={str(e)[:80]}")
        c, _ = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate",
                    token=T)
        check(f"B9 {tag} paper validate refused while versions unvalidated (409)",
              c == 409, f"status={c}")
        c, fv = http("POST",
                     f"/api/v1/teacher/content/question-versions/{v0['versionId']}/unflag",
                     token=T)
        check(f"B10 {tag} unflag version -> SUGGESTED",
              c == 200 and (isinstance(fv, dict)
                            and fv.get("validationState") == "SUGGESTED"),
              f"status={c}")

    # B11 batch validate-all positive
    c, res = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                  token=T)
    ok = (c == 200 and isinstance(res, dict)
          and res.get("paperState") == "VALIDATED"
          and res.get("versionsValidated", 0) >= 1)
    check(f"B11 {tag} validate-all -> paper VALIDATED", ok,
          f"status={c} body={str(res)[:120]}")

    # B12 student sees + attempts
    sid = hdr.get("subjectId") or hdr_subject_fallback
    c, plist = http("GET", f"/api/v1/exam-papers?subjectId={sid}", token=S)
    trow = next((p for p in plist if p.get("id") == tid), None) \
        if isinstance(plist, list) else None
    check(f"B12a {tag} student sees paper VALIDATED under its subject",
          trow is not None and trow.get("validationState") == "VALIDATED",
          f"state={trow.get('validationState') if trow else 'MISSING'}")
    qid = v0["questionId"] if v0 else None
    attempt_ok = False
    parts = []
    if qid:
        parts = student_parts(S, qid)
        if parts:
            c, _ = structured_attempt(S, qid, parts)
            attempt_ok = c == 201
            check(f"B12b {tag} student structured attempt -> 201", attempt_ok,
                  f"status={c}")
        else:
            check(f"B12b {tag} attempt skipped (no parts in student view)", False,
                  "student question view missing parts")

    # B13 PAPER-level FLAGGED gate
    c, _ = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/flag", token=T)
    check(f"B13a {tag} flag paper -> FLAGGED", c == 200, f"status={c}")
    if qid and attempt_ok:
        c, _ = structured_attempt(S, qid, parts[:1], "gated")
        check(f"B13b {tag} student attempt under FLAGGED paper -> 404 (paper gate)",
              c == 404, f"status={c}")
    c, _ = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                token=T)
    check(f"B13c {tag} batch on FLAGGED paper -> 409", c == 409, f"status={c}")

    # B14 unflag -> per-version rule resumes; restore paper VALIDATED
    c, up = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/unflag", token=T)
    state = up.get("validationState") if isinstance(up, dict) else None
    check(f"B14a {tag} unflag paper -> SUGGESTED (never straight to VALIDATED)",
          c == 200 and state == "SUGGESTED", f"status={c} state={state}")
    if qid and attempt_ok:
        c, _ = structured_attempt(S, qid, parts)
        check(f"B14b {tag} attempt works again once paper merely SUGGESTED "
              "(version still VALIDATED)", c == 201, f"status={c}")
    c, res = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                  token=T)
    check(f"B14c {tag} paper restored VALIDATED",
          c == 200 and isinstance(res, dict)
          and res.get("paperState") == "VALIDATED", f"status={c}")

    # B16 VERSION-level gate on a second question
    if v1 and qid != (v1 or {}).get("questionId"):
        qid1 = v1["questionId"]
        c, _ = http("POST",
                    f"/api/v1/teacher/content/question-versions/{v1['versionId']}/flag",
                    token=T)
        gated = {"questionId": qid1,
                 "partAnswers": [{"partId": "00000000-0000-0000-0000-0000000000aa",
                                  "answerText": "gated"}],
                 "responseTimeMs": 5000, "confidence": 3,
                 "selfDoubtFlag": False, "timedCondition": False}
        c, _ = http("POST", "/api/v1/attempts/structured", token=S, payload=gated)
        check(f"B16a {tag} attempt on FLAGGED version -> 404", c == 404,
              f"status={c}")
        c, _ = http("POST",
                    f"/api/v1/teacher/content/question-versions/{v1['versionId']}/unflag",
                    token=T)
        c, _ = http("POST", "/api/v1/attempts/structured", token=S, payload=gated)
        check(f"B16b {tag} attempt on SUGGESTED version -> 404", c == 404,
              f"status={c}")
        c, _ = http("POST",
                    f"/api/v1/teacher/content/question-versions/{v1['versionId']}/validate",
                    token=T)
        parts1 = student_parts(S, qid1)
        if parts1:
            c, _ = structured_attempt(S, qid1, parts1)
            check(f"B16c {tag} attempt on re-VALIDATED version -> 201", c == 201,
                  f"status={c}")
    return qid, v0


def topic_mapping_segment(T, qid, v0, subject_fallback):
    """B17: mapping read model + remap dogfood (first paper only)."""
    c, rows = http("GET", f"/api/v1/teacher/content/questions/{qid}/topics", token=T)
    rows = rows if isinstance(rows, list) else []
    primary_row = next((r for r in rows if r.get("primary")), None)
    anchor_code = (primary_row or {}).get("code") or ""
    check("B17a current mapping readable (anchor visible)", c == 200 and rows,
          f"status={c} rows={len(rows)} primary={anchor_code[:24]}")
    if anchor_code.startswith("ING-"):
        c, _ = http("POST", f"/api/v1/teacher/content/questions/{qid}/topics",
                    token=T, payload={"primaryNodeId": primary_row["nodeId"]})
        check("B17b anchor-as-primary refused (409)", c == 409, f"status={c}")
    c, sub = http("GET", "/api/v1/curriculum/subjects", token=T)
    s4 = next((s for s in sub if s.get("code") in ("4CH1", "4CH0")), None) \
        if isinstance(sub, list) else None
    real = None
    tree = None
    if s4 and s4.get("knowledgeNodeId"):
        c, tree = http("GET",
                       f"/api/v1/knowledge/nodes/{s4['knowledgeNodeId']}/tree",
                       token=T)
        if isinstance(tree, dict):
            real = pick_real_topic(tree)
    if real:
        stem = (v0 or {}).get("stem") or ""
        words = {w.lower() for w in re.findall(r"[a-zA-Z]{4,}", stem)}
        scored = sorted(
            [n for n in all_topics(tree, [])
             if (n.get("code") or "") and not (n.get("code") or "").startswith("ING-")],
            key=lambda n: -len(words & {w.lower() for w in
                                        re.findall(r"[a-zA-Z]{4,}", n.get("title") or "")}))
        best = scored[0] if scored else real
        print(f"mapping target: {best.get('code')} {str(best.get('title'))[:60]}",
              flush=True)
        c, res = http("POST", f"/api/v1/teacher/content/questions/{qid}/topics",
                      token=T, payload={"primaryNodeId": best["id"]})
        check("B17c remap onto real curriculum topic", c == 200, f"status={c}")
        c, res2 = http("POST", f"/api/v1/teacher/content/questions/{qid}/topics",
                       token=T, payload={"primaryNodeId": best["id"]})
        check("B17d re-map onto the SAME node stays 200 (flush regression 80b1ff8)",
              c == 200, f"status={c}")
        c, rows2 = http("GET", f"/api/v1/teacher/content/questions/{qid}/topics",
                        token=T)
        prim = next((r for r in (rows2 if isinstance(rows2, list) else [])
                     if r.get("primary")), {})
        check("B17e mapping persisted", prim.get("nodeId") == best["id"],
              f"primary={prim.get('code')}")
    else:
        check("B17 topic mapping skipped (no subject tree)", False, "no KG tree")


def main():
    if not wait_backend():
        check("B0 backend healthy", False, "no /actuator/health UP in 150s")
        verdict()
        return
    check("B0 backend healthy", True)

    # B1 teacher login + role
    c, body = http("POST", "/api/v1/auth/login",
                   payload={"email": TEACHER_EMAIL, "password": TEACHER_PASSWORD})
    tok = body.get("accessToken") if isinstance(body, dict) else None
    check("B1a teacher login", c == 200 and bool(tok), f"status={c}")
    if not tok:
        verdict()
        return
    T = tok
    c, me = http("GET", "/api/v1/auth/me", token=T)
    roles = me.get("roles", []) if isinstance(me, dict) else []
    check("B1b teacher role present", "TEACHER" in roles or "ADMIN" in roles,
          f"roles={roles}")

    # B2 bootstrap window permanently closed
    c, bs = http("GET", "/api/v1/auth/bootstrap-status")
    check("B2a bootstrap-status available=false",
          c == 200 and isinstance(bs, dict) and bs.get("available") is False,
          f"status={c}")
    c, _ = http("POST", "/api/v1/auth/bootstrap-admin", payload={
        "email": "v20.battery@syllabai-test.dev", "password": "not-a-real-claim-42",
        "displayName": "Battery"})
    check("B2b bootstrap claim refused", c in (400, 403, 409), f"status={c}")

    # B3 teacher must NOT reach admin surface
    c, _ = http("GET", "/api/v1/admin/anything", token=T)
    check("B3 teacher -> admin route 403", c == 403, f"status={c}")

    # student probe identity (reused across checks)
    c, _ = http("POST", "/api/v1/auth/register", payload={
        "email": STUDENT_EMAIL, "password": STUDENT_PW, "displayName": "V20 Battery"})
    c, body = http("POST", "/api/v1/auth/login", payload={
        "email": STUDENT_EMAIL, "password": STUDENT_PW})
    S = body.get("accessToken") if isinstance(body, dict) else None
    check("B4a student registered+logged in", c == 200 and bool(S), f"login status={c}")
    c, _ = http("GET", "/api/v1/teacher/content/review-queue", token=S)
    check("B4b student -> teacher route 403", c == 403, f"status={c}")

    # B5 census
    c, q = http("GET", "/api/v1/teacher/content/review-queue-v2", token=T)
    papers = q.get("papers", []) if isinstance(q, dict) else []
    sug = [p for p in papers if p.get("validationState") == "SUGGESTED"]
    check("B5 review-queue-v2 census", c == 200 and len(sug) >= 50,
          f"papers={len(papers)} suggested={len(sug)} "
          f"suggestedVersions={q.get('suggestedVersions') if isinstance(q, dict) else '?'}")
    if not sug:
        verdict()
        return

    # target set: N smallest fully-SUGGESTED papers with an OK bridge,
    # distinct sessions, smallest-first (keeps the battery fast + deterministic)
    ok_bridge = [p for p in sug if p.get("reconciliationStatus") == "OK"]
    pool = sorted(ok_bridge or sug,
                  key=lambda p: (p.get("versionCount") or 99,
                                 p.get("sessionLabel") or ""))
    targets, seen = [], set()
    for p in pool:
        key = p.get("sessionLabel") or p["id"]
        if key in seen:
            continue
        seen.add(key)
        targets.append(p)
        if len(targets) >= TARGET_COUNT:
            break
    print(f"dogfood set: {[t.get('sessionLabel') for t in targets]}", flush=True)

    sid_fallback = targets[0].get("subjectId")
    first_qid = first_v0 = None
    full_targets = []
    for target in targets:
        qid, v0 = battery_for_paper(T, S, target, sid_fallback,
                                    first=(first_qid is None))
        if qid is not None:
            full_targets.append(target)
            if first_qid is None:
                first_qid, first_v0 = qid, v0

    # hygiene: anything still VALIDATED while scheme-less (published before the
    # marking-contract guard existed) goes back to SUGGESTED via flag+unflag —
    # serving stops immediately (FLAGGED) and the paper re-enters review
    # honestly instead of staying unmarkable-published.
    c, plist = http("GET", "/api/v1/exam-papers", token=T)
    if isinstance(plist, list):
        for p in plist:
            if p.get("validationState") != "VALIDATED":
                continue
            c, rv = http("GET",
                         f"/api/v1/teacher/content/exam-papers/{p['id']}/review",
                         token=T)
            vers = rv.get("versions", []) if isinstance(rv, dict) else []
            if any(not v.get("schemeId") for v in vers):
                c1, _ = http("POST",
                             f"/api/v1/teacher/content/exam-papers/{p['id']}/flag",
                             token=T)
                c2, _ = http("POST",
                             f"/api/v1/teacher/content/exam-papers/{p['id']}/unflag",
                             token=T)
                check(f"hygiene [{p.get('sessionLabel')}] scheme-less VALIDATED "
                      "paper returned to review (flag+unflag)",
                      c1 == 200 and c2 == 200, f"flag={c1} unflag={c2}")

    if first_qid:
        topic_mapping_segment(T, first_qid, first_v0, sid_fallback)

    # B18 final census delta (only full-sequence targets must have left)
    c, q2 = http("GET", "/api/v1/teacher/content/review-queue-v2", token=T)
    papers2 = q2.get("papers", []) if isinstance(q2, dict) else []
    ids = {t["id"] for t in full_targets}
    still = [p for p in papers2 if p.get("id") in ids]
    check("B18 validated papers left the SUGGESTED queue", c == 200 and not still,
          f"suggested papers now="
          f"{len([p for p in papers2 if p.get('validationState') == 'SUGGESTED'])}")

    verdict()


def verdict():
    fails = [r for r in RESULTS if not r[1]]
    print(f"\nVERDICT: {'GREEN' if not fails else 'RED'} — "
          f"{len(RESULTS) - len(fails)}/{len(RESULTS)} checks passed", flush=True)
    if fails:
        print("FAILURES: " + "; ".join(f"{n} ({d})" for n, _, d in fails), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
