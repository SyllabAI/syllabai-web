/**
 * AddToTestLink — teacher affordance stub (2026-09-28 hub import).
 *
 * The demo's link pointed at its /teacher/test-builder prototype gated on
 * the mock identity store; neither is imported into web yet (teacher
 * surfaces are a later tranche that will re-gate on core's real RBAC).
 * The stub keeps the exam-questions page intact and renders nothing until
 * that tranche lands.
 */
export function AddToTestLink(_props: { courseSlug: string; codes: string[] }) {
  return null;
}
