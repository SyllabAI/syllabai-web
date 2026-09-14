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
  B6  paper review header (subjectId placement context) + teacher-only answer key
  B7  FLAGGED version blocks batch validate-all (409, fail-closed)
  B9  paper validate before versions validated (409 rule)
  B11 batch validate-all → paper VALIDATED (versions + schemes in one call)
  B12 student sees the paper VALIDATED and can attempt it (201 PENDING)
  B13 PAPER-level FLAGGED gate: flagged paper stops serving VALIDATED versions
      (student attempt 404) and blocks batch validation (409)
  B14 unflag → per-version rule resumes (attempt 201 again) → re-validate
  B16 VERSION-level gate: flag → 404, unflag → 404, re-validate → 201
  B17 topic mapping: anchor rows visible; anchor-as-primary refused (409);
      remap onto a real curriculum topic; re-map to the SAME node (the
      uq_question_topic flush regression, 80b1ff8) stays 200
  B18 final census delta

The battery is self-consistent: the target paper ends fully VALIDATED (that is
the intended dogfood outcome) and every flag/unflag cycle it opens is closed.
Secrets are NEVER printed; logs carry statuses, ids and counts only.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 v20_battery.py
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
                print(f"backend UP after {int(time.time() + seconds - deadline) + seconds:.0f}s wait")
                return True
        except Exception:
            pass
        time.sleep(8)
    return False


def pick_real_topic(node, banned_prefix="ING-", depth=0, best=None):
    """Walk the subject KG tree; return the first real TOPIC-ish node (or the
    deepest non-anchor node seen) — used to remap a question off its anchor."""
    code = node.get("code") or ""
    is_anchor = code.startswith(banned_prefix)
    if not is_anchor and node.get("id"):
        kids = node.get("children") or []
        if best is None or len(kids) == 0:
            return node
    for kid in node.get("children") or []:
        hit = pick_real_topic(kid, banned_prefix, depth + 1, best)
        if hit:
            return hit
    return best


def all_topics(node, acc):
    acc.append(node)
    for kid in node.get("children") or []:
        all_topics(kid, acc)
    return acc


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
          f"status={c} body={str(bs)[:80]}")
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

    # target = smallest fully-SUGGESTED paper with an OK bridge
    ok_bridge = [p for p in sug if p.get("reconciliationStatus") == "OK"]
    pool = ok_bridge or sug
    target = min(pool, key=lambda p: (p.get("versionCount") or 99))
    tid = target["id"]
    print(f"target paper: {tid} {target.get('paperCode')} "
          f"{target.get('sessionLabel')} versions={target.get('versionCount')} "
          f"bridge={target.get('reconciliationStatus')}", flush=True)

    # B6 review header + teacher answer key
    c, rv = http("GET", f"/api/v1/teacher/content/exam-papers/{tid}/review", token=T)
    hdr = rv.get("paper", {}) if isinstance(rv, dict) else {}
    vers = rv.get("versions", []) if isinstance(rv, dict) else []
    check("B6a review header has subjectId (§7 placement context)",
          c == 200 and hdr.get("subjectId") is not None,
          f"status={c} subjectId={str(hdr.get('subjectId'))[:8]}")
    teacher_sees_key = any(
        any(o.get("correct") for o in (v.get("options") or []))
        or (v.get("schemeId") and (v.get("points") or []))
        for v in vers)
    check("B6b teacher review shows the answer key (options flag or mark-scheme "
          "points)", teacher_sees_key,
          f"versions={len(vers)} withScheme={sum(1 for v in vers if v.get('schemeId'))}")
    v0 = vers[0] if vers else None
    v1 = vers[1] if len(vers) > 1 else None

    # B7 flagged version blocks the batch
    if v0:
        c, _ = http("POST", f"/api/v1/teacher/content/question-versions/{v0['versionId']}/flag",
                    token=T)
        check("B7a flag version -> FLAGGED", c == 200, f"status={c}")
        c, e = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                    token=T)
        msg = str(e)
        check("B7b batch blocked by FLAGGED version (409)", c == 409,
              f"status={c} msg={msg[:90]}")
        c, _ = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate",
                    token=T)
        check("B9 paper validate refused while versions unvalidated (409)", c == 409,
              f"status={c}")
        c, fv = http("POST",
                     f"/api/v1/teacher/content/question-versions/{v0['versionId']}/unflag",
                     token=T)
        check("B10 unflag version -> SUGGESTED",
              c == 200 and (isinstance(fv, dict) and
                            fv.get("validationState") == "SUGGESTED"),
              f"status={c} state={fv.get('validationState') if isinstance(fv, dict) else '?'}")

    # B11 batch validate-all positive
    c, res = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                  token=T)
    ok = (c == 200 and isinstance(res, dict)
          and res.get("paperState") == "VALIDATED"
          and res.get("versionsValidated", 0) >= 1)
    check("B11 validate-all -> paper VALIDATED", ok, f"status={c} body={str(res)[:140]}")

    # B12 student sees + attempts
    sid = hdr.get("subjectId")
    c, plist = http("GET", f"/api/v1/exam-papers?subjectId={sid}", token=S)
    trow = next((p for p in plist if p.get("id") == tid), None) if isinstance(plist, list) else None
    check("B12a student sees paper VALIDATED under its subject",
          trow is not None and trow.get("validationState") == "VALIDATED",
          f"state={trow.get('validationState') if trow else 'MISSING'}")
    qid = v0["questionId"] if v0 else None
    attempt_ok = False
    if qid:
        c, qv = http("GET", f"/api/v1/questions/{qid}", token=S)
        parts = (qv or {}).get("parts") if isinstance(qv, dict) else None
        if parts:
            payload = {"questionId": qid,
                       "partAnswers": [{"partId": p["id"], "answerText": "battery probe"}
                                       for p in parts],
                       "responseTimeMs": 12000, "confidence": 3,
                       "selfDoubtFlag": False, "timedCondition": False}
            c, res = http("POST", "/api/v1/attempts/structured", token=S, payload=payload)
            attempt_ok = c == 201
            check("B12b student structured attempt -> 201", attempt_ok,
                  f"status={c}")
        else:
            check("B12b attempt skipped (no parts in student view)", False,
                  "student question view missing parts")

    # B13 PAPER-level FLAGGED gate
    c, _ = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/flag", token=T)
    check("B13a flag paper -> FLAGGED", c == 200, f"status={c}")
    if qid and attempt_ok:
        payload = {"questionId": qid,
                   "partAnswers": [{"partId": parts[0]["id"], "answerText": "gated"}],
                   "responseTimeMs": 5000, "confidence": 3,
                   "selfDoubtFlag": False, "timedCondition": False}
        c, _ = http("POST", "/api/v1/attempts/structured", token=S, payload=payload)
        check("B13b student attempt under FLAGGED paper -> 404 (paper gate)",
              c == 404, f"status={c}")
    c, _ = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                token=T)
    check("B13c batch on FLAGGED paper -> 409", c == 409, f"status={c}")

    # B14 unflag -> per-version rule resumes; then restore paper VALIDATED
    c, up = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/unflag", token=T)
    state = up.get("validationState") if isinstance(up, dict) else None
    check("B14a unflag paper -> SUGGESTED (never straight to VALIDATED)",
          c == 200 and state == "SUGGESTED", f"status={c} state={state}")
    if qid and attempt_ok:
        payload = {"questionId": qid,
                   "partAnswers": [{"partId": p["id"], "answerText": "battery probe"}
                                   for p in parts],
                   "responseTimeMs": 5000, "confidence": 3,
                   "selfDoubtFlag": False, "timedCondition": False}
        c, _ = http("POST", "/api/v1/attempts/structured", token=S, payload=payload)
        check("B14b attempt works again once paper merely SUGGESTED (version still "
              "VALIDATED)", c == 201, f"status={c}")
    c, res = http("POST", f"/api/v1/teacher/content/exam-papers/{tid}/validate-all",
                  token=T)
    check("B14c paper restored VALIDATED",
          c == 200 and isinstance(res, dict)
          and res.get("paperState") == "VALIDATED", f"status={c}")

    # B16 VERSION-level gate on a second question
    if v1 and qid:
        qid1 = v1["questionId"]
        c, _ = http("POST",
                    f"/api/v1/teacher/content/question-versions/{v1['versionId']}/flag",
                    token=T)
        payload1 = {"questionId": qid1,
                    "partAnswers": [{"partId": "00000000-0000-0000-0000-0000000000aa",
                                     "answerText": "gated"}],
                    "responseTimeMs": 5000, "confidence": 3,
                    "selfDoubtFlag": False, "timedCondition": False}
        c, _ = http("POST", "/api/v1/attempts/structured", token=S, payload=payload1)
        check("B16a attempt on FLAGGED version -> 404", c == 404, f"status={c}")
        c, _ = http("POST",
                    f"/api/v1/teacher/content/question-versions/{v1['versionId']}/unflag",
                    token=T)
        c, _ = http("POST", "/api/v1/attempts/structured", token=S, payload=payload1)
        check("B16b attempt on SUGGESTED version -> 404", c == 404, f"status={c}")
        c, _ = http("POST",
                    f"/api/v1/teacher/content/question-versions/{v1['versionId']}/validate",
                    token=T)
        c, qv1 = http("GET", f"/api/v1/questions/{qid1}", token=S)
        parts1 = (qv1 or {}).get("parts") if isinstance(qv1, dict) else None
        if parts1:
            payload1["partAnswers"] = [{"partId": p["id"], "answerText": "battery probe"}
                                       for p in parts1]
            c, _ = http("POST", "/api/v1/attempts/structured", token=S, payload=payload1)
            check("B16c attempt on re-VALIDATED version -> 201", c == 201,
                  f"status={c}")

    # B17 topic mapping
    if qid:
        c, rows = http("GET", f"/api/v1/teacher/content/questions/{qid}/topics", token=T)
        rows = rows if isinstance(rows, list) else []
        primary_row = next((r for r in rows if r.get("primary")), None)
        anchor_code = (primary_row or {}).get("code") or ""
        check("B17a current mapping readable", c == 200 and rows,
              f"status={c} rows={len(rows)} primary={anchor_code[:20]}")
        if anchor_code.startswith("ING-"):
            c, _ = http("POST", f"/api/v1/teacher/content/questions/{qid}/topics",
                        token=T, payload={"primaryNodeId": primary_row["nodeId"]})
            check("B17b anchor-as-primary refused (409)", c == 409, f"status={c}")
        c, sub = http("GET", f"/api/v1/curriculum/subjects", token=T)
        s4 = next((s for s in sub if s.get("code") in ("4CH1", "4CH0")), None) \
            if isinstance(sub, list) else None
        real = None
        if s4 and s4.get("knowledgeNodeId"):
            c, tree = http("GET",
                           f"/api/v1/knowledge/nodes/{s4['knowledgeNodeId']}/tree",
                           token=T)
            if isinstance(tree, dict):
                cands = [n for n in all_topics(tree, [])
                         if (n.get("code") or "").startswith(("1.", "2.", "3.", "4.", "5."))]
                real = cands[0] if cands else pick_real_topic(tree)
        if real:
            stem = (v0 or {}).get("stem") or ""
            words = {w.lower() for w in re.findall(r"[a-zA-Z]{4,}", stem)}
            scored = sorted(
                cands if False else all_topics(tree, []),
                key=lambda n: -len(words & {w.lower() for w in
                                            re.findall(r"[a-zA-Z]{4,}", n.get("title") or "")}))
            best = next((n for n in scored
                         if (n.get("code") or "") and not (n.get("code") or "").startswith("ING-")),
                        real)
            print(f"mapping target: {best.get('code')} {best.get('title')}", flush=True)
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
            check("B17e mapping persisted",
                  prim.get("nodeId") == best["id"],
                  f"primary={prim.get('code')}")
        else:
            check("B17 topic mapping skipped (no subject tree)", False, "no KG tree")

    # B18 final census delta
    c, q2 = http("GET", "/api/v1/teacher/content/review-queue-v2", token=T)
    papers2 = q2.get("papers", []) if isinstance(q2, dict) else []
    still = any(p.get("id") == tid for p in papers2)
    check("B18 validated paper left the SUGGESTED queue", c == 200 and not still,
          f"suggested papers now={len([p for p in papers2 if p.get('validationState') == 'SUGGESTED'])}")

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
