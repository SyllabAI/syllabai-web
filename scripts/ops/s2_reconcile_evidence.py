#!/usr/bin/env python3
"""Deterministic reconciliation of the evidence-cycle-001 multi-part defect.

Replays the production BKT sequence for the affected learner/topic and answers:

  1. CONTAMINATED replay  — the correctness the defective evidence actually
     carried ([F, F, F], fired at first-part partial totals). MUST reproduce
     the production skill_states value exactly (0.11533544411262374) — this
     validates the replay model against ground truth before we trust its
     corrected output.

  2. CORRECTED replay     — the correctness the settled attempts actually
     earned (Q1 6/6 -> T, Q2 6/6 -> T, Q3 0/18 -> F per the documented
     conservative rule: full marks = mastery evidence).

  3. The repair decision  — recomputation (not reset): the settled attempt
     rows are the ground truth; the skill_states row is a derived projection
     and is rebuildable deterministically. Emits the exact SQL.

BKT parameters: production defaults (Bkt(0.1, 0.1, 0.25, 0.1)) — verified
against LearnerProperties.java line 72 and confirmed by the exact match in
step 1. Formula: Corbett & Anderson (1995) as implemented in BktEngine.java.
"""
from __future__ import annotations

import json
import math

# --- production BKT parameters (LearnerProperties defaults) -------------------
L0 = 0.1        # initial mastery
SLIP = 0.1      # P(incorrect | mastered)
GUESS = 0.25    # P(correct | not mastered)
T = 0.1         # learning transition


def bkt_update(prior: float, correct: bool) -> float:
    """BktEngine.update: Bayes posterior, then learning transition."""
    p = min(max(prior, 0.0), 1.0)
    if correct:
        posterior = p * (1 - SLIP) / (p * (1 - SLIP) + (1 - p) * GUESS)
    else:
        posterior = p * SLIP / (p * SLIP + (1 - p) * (1 - GUESS))
    posterior = min(max(posterior, 0.0), 1.0)
    return min(max(posterior + (1 - posterior) * T, 0.0), 1.0)


def replay(seq):
    m = L0
    steps = []
    for i, correct in enumerate(seq, 1):
        before = m
        m = bkt_update(m, correct)
        steps.append({"step": i, "correct": correct, "prior": before, "posterior": m})
    return m, steps


def main() -> int:
    # --- ground truth from the production snapshots --------------------------
    PROD_MEASURED = 0.11533544411262374       # final-probe.json topicStatus.mastery
    LEARNER = "b6caacb0-5cd2-47b4-a339-1bc72bf9a79d"
    TOPIC = "70a48c9a-ce5a-4662-92a6-c825a2d50c54"   # 4CH1-S2-f
    CLASS_MEAN_OLD = 0.1137                    # final-probe.json targetTopicFinal
    CLASS_LEARNERS = 8

    # settled attempt rows (final-probe.json targetedAttempts) in attempt order
    settled = [
        {"question": "96ae4235", "marks": 6, "of": 6},   # Q1 apparatus + litmus
        {"question": "ac5045d7", "marks": 6, "of": 6},   # Q2 neutralisation + table
        {"question": "ddf30066", "marks": 0, "of": 18},  # Q3 empty submissions
    ]
    # what the defective evidence carried (fired at first-part partial totals)
    contaminated_seq = [False, False, False]
    corrected_seq = [m["marks"] > 0 and m["marks"] >= m["of"] for m in settled]

    # --- 1. validate the replay model against production ---------------------
    contaminated, c_steps = replay(contaminated_seq)
    exact = math.isclose(contaminated, PROD_MEASURED, rel_tol=0, abs_tol=1e-15)
    print(f"contaminated replay : {contaminated!r}")
    print(f"production measured : {PROD_MEASURED!r}")
    print(f"EXACT MATCH         : {exact}")
    if not exact:
        print("REPLAY MODEL INVALID — do not trust the corrected output")
        return 1

    # --- 2. the corrected replay ---------------------------------------------
    corrected, k_steps = replay(corrected_seq)
    correct_count = sum(corrected_seq)
    class_sum_old = CLASS_MEAN_OLD * CLASS_LEARNERS
    class_mean_new = (class_sum_old - contaminated + corrected) / CLASS_LEARNERS

    print(f"\ncorrected replay    : {corrected!r}  (attempts=3, correct={correct_count})")
    print(f"corrected class mean: {class_mean_new:.4f} (was {CLASS_MEAN_OLD})")

    # --- 3. the repair --------------------------------------------------------
    out = {
        "defect": "multi-part evidence fired at first-part partial totals (pre-fe01b87)",
        "affected": {
            "learnerId": LEARNER,
            "topicNodeId": TOPIC,
            "topicCode": "4CH1-S2-f",
            "misObservedEvents": [
                {"question": "96ae4235", "firedAtPartial": "4/6", "settled": "6/6",
                 "evidenceCorrect": False, "settledCorrect": True},
                {"question": "ac5045d7", "firedAtPartial": "1/6", "settled": "6/6",
                 "evidenceCorrect": False, "settledCorrect": True},
                {"question": "ddf30066", "firedAtPartial": "0/18", "settled": "0/18",
                 "evidenceCorrect": False, "settledCorrect": False},
            ],
        },
        "contaminated": {
            "sequence": contaminated_seq,
            "mastery": contaminated,
            "productionMeasured": PROD_MEASURED,
            "replayMatchesProductionExactly": exact,
            "smartLessonReason": "LOW_MASTERY (measured 0.12 below weak ceiling 0.45)",
        },
        "corrected": {
            "sequence": corrected_seq,
            "mastery": corrected,
            "attempts": 3,
            "correctCount": correct_count,
            "classMean": class_mean_new,
            "classMeanWas": CLASS_MEAN_OLD,
            "smartLessonReason": "LOW_MASTERY (measured 0.31 below weak ceiling 0.45) — same code, honest value",
        },
        "decision": {
            "choice": "DETERMINISTIC RECOMPUTATION (not reset)",
            "rationale": [
                "the settled attempt rows are the ground truth (6/6, 6/6, 0/18) and are correct",
                "skill_states is a derived projection of the evidence stream and is rebuildable",
                "resetting would discard real evidence and return the learner to UNKNOWN",
                "the evidence events stay immutable (audit trail + kappa pairing data)",
                "one row repair corrects the whole downstream chain (class analytics and",
                "Smart Lesson read skill_states live)",
            ],
            "repairSql": (
                "UPDATE skill_states SET mastery = :corrected, correct_count = 2, "
                "version = version + 1, updated_at = now() "
                "WHERE learner_id = ':learner' AND node_id = ':topic' "
                "AND mastery = :contaminated AND correct_count = 0 AND attempts = 3;"
            ),
            "guard": "the WHERE clause matches ONLY the known-contaminated row shape; "
                    "zero rows updated = investigate, do not widen",
            "rollback": "UPDATE skill_states SET mastery = :contaminated, correct_count = 0, "
                        "version = version + 1, updated_at = now() WHERE learner_id = ':learner' "
                        "AND node_id = ':topic';",
        },
        "bktParameters": {"l0": L0, "slip": SLIP, "guess": GUESS, "learnRate": T},
        "replaySteps": {"contaminated": c_steps, "corrected": k_steps},
    }
    path = "/home/z/my-project/work/syllabai/evidence/cycle-001/reconciliation.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    print(f"\nwritten {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
