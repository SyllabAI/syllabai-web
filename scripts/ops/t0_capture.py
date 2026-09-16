#!/usr/bin/env python3
"""Evidence Accumulation t0 baseline capture — read-only runner (Session 76).

Executes scripts/ops/t0_capture.sql against production (or any representative
database) and writes the t0 artifact JSON. Designed for the operator's Neon
path — the same non-destructive access pattern Session 75 used:

  * DSN comes from the DATABASE_URL env var — never hardcoded, never printed.
  * The session is opened with `default_transaction_read_only = on`, a
    statement timeout, and TLS; the capture is SELECT-only by contract
    (validated locally against the Flyway schema before shipping).
  * The artifact records: capture timestamp, repo lineages (the application
    SHA the directive requires), server identity, Flyway head, and every
    t0 section from the SQL file.
  * A compact Smart Lesson INPUT replication (decay-adjusted mastery + band,
    EbbinghausDecayService semantics) is computed from the captured rows so
    the artifact is self-contained for t1 comparison. The replication is
    labeled as such — the live decision surface remains the app's.

Usage (operator / a session holding the Neon path):
  DATABASE_URL='postgresql://...' python3 t0_capture.py --out t0-artifact.json

Exit codes: 0 clean capture; 2 integrity invariants non-empty (t0 BLOCKED);
1 any other failure.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg

HERE = Path(__file__).resolve().parent
SQL_PATH = HERE / "t0_capture.sql"

REPOS = {
    "syllabai-core": "/home/z/my-project/work/syllabai-core",
    "syllabai-web": "/home/z/my-project/work/syllabai-web",
    "syllabai-parser": "/home/z/my-project/work/syllabai-parser",
    "syllabai-resources": "/home/z/my-project/work/syllabai-resources",
    "syllabai": "/home/z/my-project/work/syllabai",
}

# production decay semantics (DecayParams.paperDefaults / EbbinghausDecayService)
TAU_LOW_DAYS, TAU_MID_DAYS, TAU_HIGH_DAYS = 30, 90, 365
LOW_BAND_CEILING, HIGH_BAND_FLOOR, FLOOR = 0.45, 0.8, 0.1


def band_of(mastery: float) -> str:
    if mastery < LOW_BAND_CEILING:
        return "LOW"
    if mastery < HIGH_BAND_FLOOR:
        return "DEVELOPING"
    return "SECURE"


def decayed(mastery: float, last_practiced: str, now: datetime) -> float:
    lp = datetime.fromisoformat(last_practiced.replace("Z", "+00:00"))
    if now <= lp:
        return min(max(mastery, 0.0), 1.0)
    tau_days = (TAU_LOW_DAYS if mastery < LOW_BAND_CEILING
                else TAU_MID_DAYS if mastery < HIGH_BAND_FLOOR
                else TAU_HIGH_DAYS)
    elapsed_s = (now - lp).total_seconds()
    d = mastery * math.exp(-elapsed_s / (tau_days * 86400.0))
    return max(FLOOR, min(max(d, 0.0), 1.0))


def split_statements(sql_text: str):
    """Split on semicolons that end a statement (comment-aware)."""
    stmts, buf, in_block = [], [], False
    for line in sql_text.splitlines():
        stripped = line.strip()
        if stripped.startswith("/*") and "*/" not in stripped:
            in_block = True
        if in_block:
            if "*/" in stripped:
                in_block = False
            continue
        if stripped.startswith("--"):
            # keep section markers so results can be tagged
            if stripped.startswith("-- ═══"):
                m = re.match(r"-- ═+\s*(T0\.\d+\s*—.*?)\s*═+\s*$", stripped)
                if m:
                    buf.append(f"/*__SECTION__{m.group(1).strip()}*/")
            continue
        buf.append(line)
        if line.rstrip().endswith(";"):
            stmt = "\n".join(buf).strip()
            if re.search(r"\b(select|with)\b", stmt, re.I):
                stmts.append(stmt)
            buf = []
    if buf:
        stmt = "\n".join(buf).strip()
        if re.search(r"\b(select|with)\b", stmt, re.I):
            stmts.append(stmt)
    return stmts


def repo_lineages() -> dict:
    out = {}
    for name, path in REPOS.items():
        try:
            sha = subprocess.check_output(["git", "-C", path, "rev-parse", "HEAD"], text=True).strip()
            subj = subprocess.check_output(["git", "-C", path, "log", "-1", "--format=%s"], text=True).strip()[:100]
            dirty = bool(subprocess.check_output(["git", "-C", path, "status", "--porcelain"], text=True).strip())
            out[name] = {"sha": sha, "subject": subj, "dirty": dirty}
        except Exception as e:
            out[name] = {"error": str(e)[:120]}
    return out


def rows_to_json(cur) -> list:
    cols = [d[0] for d in cur.description]
    out = []
    for row in cur.fetchall():
        rec = {}
        for c, v in zip(cols, row):
            if isinstance(v, datetime):
                rec[c] = v.isoformat()
            elif isinstance(v, Decimal):
                rec[c] = float(v)
            else:
                rec[c] = v
        out.append(rec)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="t0-artifact.json")
    ap.add_argument("--sql", default=str(SQL_PATH))
    args = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("FAIL: DATABASE_URL env var not set (the operator's Neon path provides it)")
        return 1

    sql_text = Path(args.sql).read_text()
    statements = split_statements(sql_text)
    if not statements:
        print("FAIL: no statements parsed from", args.sql)
        return 1
    print(f"[t0] {len(statements)} read-only statements parsed")

    artifact = {
        "procedure": "Evidence Accumulation t0 baseline capture (Session 76, 2026-09-16)",
        "preparedAt": "2026-09-16",
        "status": "CAPTURED",
        "note": "t0 is a fresh capture at a defined moment; it is NOT a re-derivation "
                "of cycle-001 history. Read-only session; integrity invariants audited "
                "at capture time.",
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "lineages": repo_lineages(),
        "sections": {},
    }

    try:
        with psycopg.connect(dsn, connect_timeout=20, sslmode="require") as conn:
            with conn.cursor() as cur:
                cur.execute("SET default_transaction_read_only = on")
                cur.execute("SET statement_timeout = '60s'")
                section = "preamble"
                for i, stmt in enumerate(statements, 1):
                    sm = re.search(r"/\*__SECTION__(.*?)\*/", stmt)
                    if sm:
                        section = sm.group(1)
                        stmt = re.sub(r"/\*__SECTION__.*?\*/", "", stmt).strip()
                    cur.execute(stmt)
                    if cur.description is None:
                        continue
                    data = rows_to_json(cur)
                    key = f"{section} [{i}]"
                    artifact["sections"].setdefault(section, {})[f"stmt_{i}"] = data
                    preview = data[0] if data else "(no rows)"
                    print(f"  [{i:2d}] {section[:52]:52s} {len(data):4d} rows")
    except Exception as e:
        print(f"FAIL executing capture: {type(e).__name__}: {str(e)[:300]}")
        return 1

    # ── integrity verdict + smart-lesson input replication ──────────────────────
    secs = artifact["sections"]
    t07_key = next((k for k in secs if k.startswith("T0.7")), None)
    t07_vals = list(secs.get(t07_key, {}).values())
    proj_mismatch = t07_vals[0] if len(t07_vals) > 0 else []
    settled_no_ev = t07_vals[1] if len(t07_vals) > 1 else []
    dup_rows = t07_vals[2] if len(t07_vals) > 2 else []

    artifact["integrity"] = {
        "projectionMismatches": len(proj_mismatch),
        "settledWithoutEvidence": len(settled_no_ev),
        "duplicateSkillStateRows": len(dup_rows),
        "verdict": "CLEAN" if not (proj_mismatch or settled_no_ev or dup_rows) else "BLOCKED",
    }

    # Smart Lesson inputs replication (raw -> decay-adjusted -> band)
    t09_key = next((k for k in secs if k.startswith("T0.9")), None)
    sl_rows = list(secs.get(t09_key, {}).values())[0:1]
    sl_rows = sl_rows[0] if sl_rows else []
    now = datetime.now(timezone.utc)
    artifact["smartLessonInputs"] = [
        {**r,
         "decayAdjustedMastery": round(decayed(float(r["raw_mastery"]), r["last_practiced_at"], now), 10),
         "band": band_of(decayed(float(r["raw_mastery"]), r["last_practiced_at"], now)),
         "weakCeiling": LOW_BAND_CEILING}
        for r in sl_rows
    ]

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(artifact, f, indent=1, sort_keys=True, default=str)
    print(f"\n[t0] integrity: {artifact['integrity']['verdict']} "
          f"(proj_mismatch={artifact['integrity']['projectionMismatches']}, "
          f"settled_no_ev={artifact['integrity']['settledWithoutEvidence']}, "
          f"dup={artifact['integrity']['duplicateSkillStateRows']})")
    print(f"[t0] written {args.out}")
    return 0 if artifact["integrity"]["verdict"] == "CLEAN" else 2


if __name__ == "__main__":
    sys.exit(main())
