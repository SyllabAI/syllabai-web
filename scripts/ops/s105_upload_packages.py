#!/usr/bin/env python3
"""s105 — upload the SME corpus packages to the live core (ADR-026 import).

Executed by .github/workflows/sme-package-upload.yml (workflow_dispatch) with
the PILOT_TEACHER_* Actions secrets. The packages are the release assets of
the web repo release `sme-corpus-2026-09-18` (sha256-spined; the expected
digests are pinned in this file AND in the operator runbook,
download/s104-sme-import/VERIFICATION-AND-RUNBOOK.md).

Flow:
  1. sha256-verify both packages (fail-closed before any network write)
  2. teacher login → probe GET /api/v1/admin/question-bank/status
     - 200 → the account holds ADMIN → upload BOTH packages (questions first,
       notes second — see the runbook §4) and print both IngestSummary JSONs
     - 403 → OPERATOR_BOUNDARY: no ADMIN credential is reachable from the
       agent lane (verified: no ADMIN secret exists in any repo) → print the
       verdict, exit 0, leave the live bank untouched. The operator's manual
       fallback is runbook Path B.

Usage: TEACHER_EMAIL=... TEACHER_PASSWORD=... python3 s105_upload_packages.py
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
PKG_DIR = os.environ.get("PKG_DIR", "packages")
OUT_PATH = os.environ.get("RESULT_PATH", "s105-upload-result.json")

# pinned digests — SHA256SUMS of the 2026-09-18 build (runbook §1)
EXPECTED = {
    "sme-question-package.zip": "4bb53004f8b6f01369056b1b7097e65127d27c99e039bc6db28a437a891cabaa",
    "sme-revision-notes-package.zip": "837ea8f2576a801064abde47299cc3482698832c9cb2f47b084fdfe75fe4dc05",
}

UPLOADS = [
    ("sme-question-package.zip", "/api/v1/admin/question-bank/ingest"),
    ("sme-revision-notes-package.zip", "/api/v1/admin/revision-notes/ingest"),
]


def http(method, path, token=None, payload=None, timeout=300):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers=headers)
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


def multipart_upload(token, path, filename, content, content_type="application/zip"):
    boundary = "s105corpusboundary7f3a91"
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {content_type}\r\n\r\n".encode(),
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        BASE + path, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        })
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:800]
        try:
            return e.code, json.loads(detail)
        except Exception:
            return e.code, {"raw": detail}


def main():
    result = {"probe": None, "uploads": [], "verdict": None}

    # 1. fail-closed digest verification
    for name, expected in EXPECTED.items():
        path = os.path.join(PKG_DIR, name)
        if not os.path.isfile(path):
            print(f"FAIL missing package {name}")
            result["verdict"] = "MISSING_PACKAGE"
            _write(result)
            return 1
        digest = hashlib.sha256(open(path, "rb").read()).hexdigest()
        ok = digest == expected
        print(f"sha256 {name}: {'OK' if ok else 'MISMATCH'} ({digest[:16]}…)")
        if not ok:
            result["verdict"] = "SHA256_MISMATCH"
            _write(result)
            return 1

    # 2. login + admin probe
    if not TEACHER_EMAIL or not TEACHER_PASSWORD:
        print("FAIL TEACHER_EMAIL/TEACHER_PASSWORD not set")
        result["verdict"] = "NO_CREDENTIALS"
        _write(result)
        return 1
    status, login = http("POST", "/api/v1/auth/login",
                         payload={"email": TEACHER_EMAIL, "password": TEACHER_PASSWORD})
    if status != 200 or not isinstance(login, dict) or not login.get("accessToken"):
        print(f"FAIL teacher login status={status}")
        result["verdict"] = "LOGIN_FAILED"
        result["probe"] = {"status": status}
        _write(result)
        return 1
    print("teacher login OK")
    token = login["accessToken"]

    status, body = http("GET", "/api/v1/admin/question-bank/status", token=token)
    result["probe"] = {"status": status, "body": body}
    print(f"admin question-bank status probe: HTTP {status}")
    if status == 403:
        print("OPERATOR_BOUNDARY: the pilot-teacher account does not hold ADMIN.")
        print("No ADMIN secret exists in any repo — the operator's manual path")
        print("is runbook Path B (download/s104-sme-import/VERIFICATION-AND-RUNBOOK.md).")
        result["verdict"] = "OPERATOR_BOUNDARY"
        _write(result)
        return 0
    if status != 200:
        print(f"FAIL probe status={status} body={json.dumps(body)[:300]}")
        result["verdict"] = "PROBE_FAILED"
        _write(result)
        return 1
    print("probe body:", json.dumps(body))

    # 3. upload both packages (questions first, notes second)
    for name, endpoint in UPLOADS:
        content = open(os.path.join(PKG_DIR, name), "rb").read()
        print(f"uploading {name} ({len(content)/1e6:.1f} MB) -> {endpoint} …")
        t0 = time.time()
        status, body = multipart_upload(token, endpoint, name, content)
        elapsed = time.time() - t0
        print(f"  HTTP {status} in {elapsed:.0f}s: {json.dumps(body)[:500]}")
        result["uploads"].append({"file": name, "status": status,
                                  "body": body, "seconds": round(elapsed, 1)})
        if status != 200:
            result["verdict"] = "UPLOAD_FAILED"
            _write(result)
            return 1

    # 4. post-upload status
    for label, path in [("question-bank", "/api/v1/admin/question-bank/status"),
                        ("revision-notes", "/api/v1/admin/revision-notes/status")]:
        status, body = http("GET", path, token=token)
        print(f"post-upload {label} status: HTTP {status} {json.dumps(body)[:300]}")
        result[f"status_{label}"] = {"status": status, "body": body}

    result["verdict"] = "UPLOADED"
    _write(result)
    return 0


def _write(result):
    with open(OUT_PATH, "w") as f:
        json.dump(result, f, indent=1)
    print(f"result written to {OUT_PATH}")


if __name__ == "__main__":
    sys.exit(main())
