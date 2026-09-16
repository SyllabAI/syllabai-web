-- ─────────────────────────────────────────────────────────────────────────────
-- Evidence Accumulation t0 baseline capture — read-only SQL (Session 76, 2026-09-16)
--
-- PURPOSE: the clean, reproducible t0 measurement for the Evidence
-- Accumulation / Closed-Loop Pilot. t0 is a FRESH CAPTURE at a defined
-- moment (timestamp + lineage + full state snapshot), NOT a re-derivation
-- from cycle-001 history. The repaired historical state is part of the
-- state being measured; it does not become the baseline by virtue of being
-- corrected.
--
-- CONTRACT (all queries in this file):
--   * READ-ONLY. No INSERT/UPDATE/DELETE/DDL anywhere. The runner
--     (t0_capture.py) additionally opens the session with
--     `default_transaction_read_only = on` and a statement timeout.
--   * Every section emits a SMALL, JSON-serializable result set so the
--     runner can embed it verbatim in the t0 artifact.
--   * No PII beyond ids: learner/topic ids are retained (needed to track
--     the same population at t1); emails are never selected.
--
-- VALIDATION STATUS: PREPARED. Column references cross-checked against the
-- Flyway V1..V26 schema (syllabai-core). Not yet executed against
-- production — execution requires the operator's Neon path (the same
-- read-only API pattern Session 75 used) and is recorded as PREPARED, not
-- VERIFIED, until then.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ T0.1 — capture identity ═════════════════════════════════════════════════
-- Timestamp + server + schema version. The application SHA is recorded by
-- the RUNNER (repo lineages at capture time); the DB contributes the
-- Flyway head so the artifact can prove which schema it measured.
SELECT now()              AS captured_at,
       current_user       AS db_user,
       current_database() AS db_name,
       version()          AS pg_version;

SELECT installed_rank, version, description, installed_on, success
FROM flyway_schema_history
WHERE success
ORDER BY installed_rank DESC
LIMIT 3;

-- ═══ T0.2 — learner / topic population ═══════════════════════════════════════
-- Cohort definition: enabled learners holding the STUDENT role. Topics:
-- knowledge_nodes by type + validation state (population, not measurement).
SELECT count(*) FILTER (WHERE u.enabled)                          AS enabled_students,
       count(*) FILTER (WHERE NOT u.enabled)                      AS disabled_students
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r       ON r.name = ur.role
WHERE r.name = 'STUDENT';

SELECT node_type, validation_status, count(*) AS nodes
FROM knowledge_nodes
GROUP BY node_type, validation_status
ORDER BY node_type, validation_status;

-- ═══ T0.3 — measured topics + class state (the analytics inputs) ═════════════
-- Measured = real evidence only (a skill_states row exists). Per-topic
-- aggregation replicates the ClassAnalyticsService read model: mean of
-- STORED mastery over measured learners, banded LOW/DEVELOPING/SECURE with
-- the production thresholds (0.45 / 0.8 — DecayParams.paperDefaults).
-- Weak topic = measured AND mean < 0.45 (the same ceiling the Smart Lesson
-- and weakness-options use).
SELECT n.id                AS topic_node_id,
       n.code,
       count(ss.learner_id) AS learners_measured,
       round(avg(ss.mastery)::numeric, 10) AS mean_mastery,
       sum(ss.attempts)     AS total_attempts,
       sum(ss.correct_count) AS total_correct,
       CASE WHEN avg(ss.mastery) < 0.45 THEN 'LOW'
            WHEN avg(ss.mastery) < 0.8  THEN 'DEVELOPING'
            ELSE 'SECURE' END            AS band,
       (avg(ss.mastery) < 0.45)         AS weak
FROM skill_states ss
JOIN knowledge_nodes n ON n.id = ss.node_id
WHERE n.node_type IN ('TOPIC', 'SUBTOPIC')
GROUP BY n.id, n.code
ORDER BY learners_measured DESC, mean_mastery ASC, n.code;

-- ═══ T0.4 — mastery distribution (all skill_states rows) ════════════════════
-- Full distribution + histogram, so t1 can show movement, not just means.
SELECT count(*)                      AS skill_state_rows,
       round(min(mastery)::numeric, 10) AS min_mastery,
       round(max(mastery)::numeric, 10) AS max_mastery,
       round(avg(mastery)::numeric, 10) AS mean_mastery,
       sum(attempts)                  AS total_attempts,
       sum(correct_count)             AS total_correct
FROM skill_states;

SELECT width_bucket(mastery, 0.0, 1.0, 10) AS bucket_10pct,
       count(*)                            AS rows,
       round(min(mastery)::numeric, 10)     AS bucket_min,
       round(max(mastery)::numeric, 10)     AS bucket_max
FROM skill_states
GROUP BY 1
ORDER BY 1;

-- Per-learner-topic state (the full t0 learner-state matrix; ids only).
SELECT ss.learner_id, ss.node_id, n.code,
       round(ss.mastery::numeric, 10) AS mastery,
       ss.attempts, ss.correct_count, ss.last_practiced_at, ss.version
FROM skill_states ss
JOIN knowledge_nodes n ON n.id = ss.node_id
ORDER BY ss.learner_id, n.code;

-- ═══ T0.5 — attempts + settled marks ════════════════════════════════════════
-- Attempt population by lifecycle state + evidence flag, and the settled
-- totals (the ground truth the projection must agree with).
SELECT marking_state, evidence_emitted, count(*) AS attempts
FROM attempts
GROUP BY marking_state, evidence_emitted
ORDER BY marking_state, evidence_emitted;

SELECT provenance, count(*) AS attempts
FROM attempts
GROUP BY provenance
ORDER BY provenance;

-- Settled structured attempts: total marks + raw correctness (the rows the
-- evidence events must agree with — recordTotalMarks' conservative rule).
SELECT a.id AS attempt_id, a.learner_id, a.question_id,
       a.marks_awarded, a.correct, a.marking_state, a.evidence_emitted,
       a.created_at
FROM attempts a
WHERE a.marking_state IN ('HUMAN_MARKED', 'OVERRIDDEN', 'SMART_MARKED', 'AUTO_GRADED')
ORDER BY a.created_at;

-- Answer-level marking state (part granularity — the multi-part invariant's
-- raw material).
SELECT marking_state, count(*) AS answers
FROM answers
GROUP BY marking_state
ORDER BY marking_state;

-- ═══ T0.6 — evidence count + event-level truth ══════════════════════════════
-- Evidence events are telemetry rows (BKT_UPDATED), one per fired evidence
-- event, payload carrying attemptId/questionId/correctness/marks. Counting
-- by learner×topic AND by attempt ties the event stream to the rows.
SELECT count(*) AS bkt_updated_events,
       count(DISTINCT (payload->>'attemptId')) AS distinct_attempts,
       min(occurred_at) AS first_event, max(occurred_at) AS last_event
FROM telemetry_events
WHERE event_type = 'BKT_UPDATED';

-- Event-level detail (ids + correctness + marks only — the audit trail t1
-- compares against; also the κ pairing source).
SELECT id, learner_id, occurred_at,
       payload->>'attemptId'   AS attempt_id,
       payload->>'questionId'  AS question_id,
       payload->>'correctness' AS correctness,
       payload->>'marksAwarded' AS marks_awarded,
       payload->>'marksTotal'  AS marks_total,
       payload->'topicNodeIds' AS topic_node_ids
FROM telemetry_events
WHERE event_type = 'BKT_UPDATED'
ORDER BY occurred_at;

-- ═══ T0.7 — integrity invariants (audited AT CAPTURE, not later) ════════════
-- The Session-75 whole-projection audit, made a standing part of t0:
-- stored (attempts, correct_count) must equal the evidence-derived values
-- per (learner, topic). Topic mapping replicates EvidencePublisher's
-- authoritative semantics exactly: the question's PRIMARY topic node UNION
-- its secondary question_topics mappings (deduplicated). Zero mismatches
-- expected; any mismatch at t0 blocks the pilot.
WITH derived AS (
    SELECT a.learner_id,
           t.node_id,
           count(*)                          AS d_attempts,
           count(*) FILTER (WHERE a.correct) AS d_correct
    FROM attempts a
    JOIN LATERAL (
        SELECT q.primary_topic_node_id AS node_id
        FROM questions q
        WHERE q.id = a.question_id
        UNION
        SELECT qt.node_id
        FROM question_topics qt
        WHERE qt.question_id = a.question_id
    ) t ON true
    WHERE a.evidence_emitted
    GROUP BY a.learner_id, t.node_id
)
SELECT ss.learner_id, ss.node_id,
       ss.attempts AS stored_attempts, d.d_attempts,
       ss.correct_count AS stored_correct, d.d_correct
FROM skill_states ss
LEFT JOIN derived d ON d.learner_id = ss.learner_id AND d.node_id = ss.node_id
WHERE COALESCE(ss.attempts, 0) <> COALESCE(d.d_attempts, 0)
   OR COALESCE(ss.correct_count, 0) <> COALESCE(d.d_correct, 0);

-- Settled attempts without evidence (must be empty; the once-only guard's
-- inverse — every settled attempt must have fired exactly once).
SELECT a.id AS attempt_id, a.learner_id, a.question_id, a.marking_state
FROM attempts a
WHERE a.marking_state IN ('HUMAN_MARKED', 'OVERRIDDEN', 'SMART_MARKED')
  AND NOT a.evidence_emitted
  AND NOT EXISTS (SELECT 1 FROM answers ans
                  WHERE ans.attempt_id = a.id AND ans.marking_state = 'PENDING');

-- Duplicate skill_states rows per (learner, node) (must be empty; the
-- unique constraint should make this structurally impossible).
SELECT learner_id, node_id, count(*) AS rows
FROM skill_states
GROUP BY learner_id, node_id
HAVING count(*) > 1;

-- ═══ T0.8 — tutor signals (where applicable) ════════════════════════════════
-- Structured tutor engagement only (the deterministic intent matcher's
-- output — raw chat never mutates state by design).
SELECT count(*) AS engagement_rows,
       count(DISTINCT learner_id) AS learners_with_engagement,
       count(DISTINCT node_id)    AS topics_engaged,
       sum(evidence_count)        AS total_evidence_signals
FROM tutor_topic_engagements;

SELECT learner_id, node_id, occurred_at, evidence_count, refused, answer_model
FROM tutor_topic_engagements
ORDER BY occurred_at;

-- ═══ T0.9 — Smart Lesson state (inputs at t0) ═══════════════════════════════
-- Smart Lesson is computed live from skill_states (smart-lesson/v2 ladder);
-- the decision is replicated by code, not SQL. t0 records the INPUTS:
-- per (learner, topic): raw mastery + last_practiced_at (decay inputs) +
-- attempts — everything the ladder reads. The replication itself uses the
-- production semantics (decay-adjusted mastery, weak ceiling 0.45) and is
-- executed by the runner's verifier, not this file.
SELECT ss.learner_id, ss.node_id, n.code,
       round(ss.mastery::numeric, 10) AS raw_mastery,
       ss.last_practiced_at, ss.attempts, ss.correct_count
FROM skill_states ss
JOIN knowledge_nodes n ON n.id = ss.node_id
WHERE n.node_type IN ('TOPIC', 'SUBTOPIC')
ORDER BY ss.learner_id, n.code;

-- Review-schedule state (the decay loop's output surface).
SELECT status, count(*) AS review_schedules,
       count(*) FILTER (WHERE due_at > now()) AS due_later
FROM review_schedules
GROUP BY status
ORDER BY status;

-- ═══ T0.10 — targeted-test / intervention state ═════════════════════════════
-- Cycle-001's targeted test + any intervention runs (E2 records).
SELECT run_id, learner_id, status, origin, action_type,
       intervention_version, terminal_outcome, created_at, completed_at
FROM intervention_run
ORDER BY created_at;

-- Servable question inventory on measured topics (targetability at t0).
-- Servability = the ServableQuestionSpec rule, in SQL: active question AND
-- (MCQ-type OR current version VALIDATED) AND owning paper not REJECTED/
-- unvalidated — the same boundary the learner-facing surface enforces.
WITH current_version AS (
    SELECT DISTINCT ON (question_id) question_id, validation_state
    FROM question_versions
    ORDER BY question_id, version DESC
)
SELECT n.code AS topic_code,
       count(*) FILTER (WHERE q.active
                          AND (q.question_type <> 'STRUCTURED'
                               OR cv.validation_state = 'VALIDATED')
                          AND COALESCE(p.validation_state, 'VALIDATED') = 'VALIDATED')
           AS servable
FROM knowledge_nodes n
LEFT JOIN questions q   ON q.primary_topic_node_id = n.id
LEFT JOIN current_version cv ON cv.question_id = q.id
LEFT JOIN exam_papers p ON p.id = q.exam_paper_id
WHERE n.node_type IN ('TOPIC', 'SUBTOPIC')
GROUP BY n.code
HAVING count(*) FILTER (WHERE q.active
                          AND (q.question_type <> 'STRUCTURED'
                               OR cv.validation_state = 'VALIDATED')
                          AND COALESCE(p.validation_state, 'VALIDATED') = 'VALIDATED') > 0
ORDER BY servable DESC, n.code;

-- ═══ T0.11 — smart mark / κ state (the gate's inputs) ═══════════════════════
SELECT count(*) AS smart_mark_runs,
       count(*) FILTER (WHERE validation_passed) AS validation_passed,
       count(*) FILTER (WHERE NOT validation_passed) AS validation_failed,
       count(*) FILTER (WHERE failure_reason IS NOT NULL) AS with_failure_reason
FROM smart_mark_results;

SELECT count(*) AS agreement_evaluations,
       count(*) FILTER (WHERE passed) AS passed,
       count(*) FILTER (WHERE NOT passed) AS failed,
       max(kappa) AS max_kappa, min(kappa) AS min_kappa
FROM smart_mark_agreement_evaluations;
