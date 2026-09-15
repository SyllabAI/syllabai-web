/**
 * SyllabAI shared frontend types — mirror the backend DTOs (Master Spec §22).
 */

export interface UserView {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  user: UserView;
}

export interface NodeView {
  id: string;
  code: string;
  type: string;
  title: string;
  description: string | null;
  validationStatus: string;
  provenance: string | null;
  children: NodeView[];
}

export interface PrerequisiteView {
  id: string;
  code: string;
  type: string;
  title: string;
  depth: number;
}

export interface OptionView {
  id: string;
  label: string;
  text: string;
}

export interface PartView {
  id: string;
  label: string;
  prompt: string;
  commandWord: string | null;
  marks: number;
}

export interface StudentQuestionView {
  id: string;
  externalRef: string | null;
  type: string;
  stem: string;
  marks: number;
  difficulty: number;
  expectedTimeSeconds: number;
  commandWord: string | null;
  primaryTopicNodeId: string;
  examPaperId: string | null;
  options: OptionView[];
  parts: PartView[];
}

export interface StructuredAttemptPartResult {
  partId: string;
  label: string;
  marksPossible: number;
  markingState: string;
  marksAwarded: number | null;
}

export interface StructuredAttemptResultView {
  attemptId: string;
  questionId: string;
  marksPossible: number;
  markingState: string;
  submittedAt: string;
  parts: StructuredAttemptPartResult[];
}

export interface AttemptResultView {
  attemptId: string;
  questionId: string;
  correct: boolean;
  marksAwarded: number;
  marksTotal: number;
  correctOptionLabel: string | null;
  implicatedMisconceptionIds: string[];
  submittedAt: string;
}

export interface SkillStateView {
  nodeId: string;
  mastery: number;
  effectiveMastery: number;
  band: string;
  attempts: number;
  correctCount: number;
  lastPracticedAt: string;
  proceduralFluencyGap: number | null;
  /** Human KG title (P1: backend-resolved); null → callers fall back. */
  nodeName?: string | null;
}

export interface MisconceptionStateView {
  misconceptionNodeId: string;
  probability: number;
  active: boolean;
  evidenceCount: number;
  lastEvidenceAt: string;
  /** Human KG title (P1: backend-resolved); null → callers fall back. */
  misconceptionName?: string | null;
}

export interface ReviewView {
  nodeId: string;
  dueAt: string;
  reason: string;
  /** Human KG title (P1: backend-resolved); null → callers fall back. */
  nodeName?: string | null;
}

export interface LearnerStateView {
  learnerId: string;
  skillStates: SkillStateView[];
  misconceptionStates: MisconceptionStateView[];
  pendingReviews: ReviewView[];
  /** V21 (P7): topics the learner recently asked the Tutor about (last 30 days). */
  tutorEngagements?: TutorEngagementView[];
}

export interface TutorEngagementView {
  nodeId: string;
  /** Human KG title (backend-resolved); null → callers fall back to the graph/code. */
  nodeTitle?: string | null;
  asks: number;
  lastAskedAt: string;
  refusedAny: boolean;
}

export interface SubjectView {
  id: string;
  code: string;
  name: string;
  knowledgeNodeId: string | null;
}

// ── Tutor chat (T-025, mirrors the T-024 backend DTOs) ──

/** One verbatim source reference under a tutor answer ([n] markers, 1-based). */
export interface TutorCitation {
  index: number;
  label: string;
  sourceType: string;
  documentId: string | null;
  page: number | null;
  nodeId: string | null;
  deepLink: string;
}

/** A curriculum topic the intent matcher selected for the question. */
export interface TutorTopicMatch {
  code: string;
  title: string;
  matchScore: number;
}

/** POST /api/v1/tutor/ask response (T-024 TutorAnswerView). */
export interface TutorAnswerView {
  answer: string;
  citations: TutorCitation[];
  topics: TutorTopicMatch[];
  evidenceCount: number;
  model: string | null;
  provider: string;
  refused: boolean;
  latencyMs: number;
}

// ── Personalized knowledge graph (T-028, mirrors the F-034 backend DTOs) ──

/** KG node + THIS learner's annotations (null = honest "not practised / no signal"). */
export interface LearnerNodeWithStateView {
  id: string;
  code: string;
  type: string;
  title: string;
  description: string | null;
  childIds: string[];
  mastery: number | null;
  effectiveMastery: number | null;
  band: string | null;
  attempts: number | null;
  correctCount: number | null;
  lastPracticedAt: string | null;
  proceduralFluencyGap: number | null;
  reviewDueAt: string | null;
  reviewReason: string | null;
  misconceptionProbability: number | null;
  misconceptionActive: boolean | null;
}

/** A drawable prerequisite edge: prerequisiteId → nodeId (which requires it). */
export interface LearnerPrerequisiteEdgeView {
  prerequisiteId: string;
  prerequisiteCode: string;
  nodeId: string;
  nodeCode: string;
}

/** GET /api/v1/learners/me/knowledge-graph response (F-034). */
// Smart Lesson MVP (productization sprint §2): ONE explainable next action
// for a selected topic — deterministic, evidence-gated, closed-loop.
export interface SmartLessonView {
  learnerId: string;
  rootId: string;
  topicNodeId: string;
  topicCode: string | null;
  topicTitle: string | null;
  asOf: string;
  policy: string;
  action: SmartLessonActionView;
  topicStatus: SmartLessonTopicStatusView;
  prerequisites: SmartLessonPrerequisiteStatusView[];
  misconceptions: SmartLessonMisconceptionStatusView[];
  evidence: SmartLessonEvidenceFactView[];
}

export interface SmartLessonActionView {
  actionType: string;
  reasonCode: string;
  targetNodeId: string;
  targetCode: string | null;
  targetTitle: string | null;
  questionId: string | null;
  servableQuestionCount: number;
  reasonDetail: string;
}

export interface SmartLessonTopicStatusView {
  coverage: string;
  attempts: number;
  mastery: number | null;
  effectiveMastery: number | null;
  reviewDue: boolean;
  strongestMisconceptionProbability: number | null;
  fluencyGap: number | null;
  tutorAsks: number;
  servableQuestions: number;
}

export interface SmartLessonEvidenceFactView {
  key: string;
  value: string;
}

export interface SmartLessonPrerequisiteStatusView {
  nodeId: string;
  code: string | null;
  title: string | null;
  effectiveMastery: number | null;
  attempts: number | null;
  measuredWeak: boolean;
}

export interface SmartLessonMisconceptionStatusView {
  nodeId: string;
  code: string | null;
  title: string | null;
  probability: number | null;
  active: boolean;
  remediationNodeCode: string | null;
}

export interface LearnerKnowledgeGraphView {
  learnerId: string;
  rootId: string;
  rootCode: string;
  rootTitle: string;
  asOf: string;
  nodes: LearnerNodeWithStateView[];
  prerequisiteEdges: LearnerPrerequisiteEdgeView[];
}

// ── T-029 teacher review surface (mirrors core TeacherViews) ──

export interface TeacherLearnerView {
  id: string;
  displayName: string;
  email: string;
  createdAt: string;
}

export interface SmartMarkBreakdownItem {
  markPointId?: string;
  awarded?: boolean;
  [key: string]: unknown;
}

export interface SmartMarkView {
  id: string;
  pipelineVersion: string | null;
  modelId: string | null;
  marksAwarded: number;
  confidence: number | null;
  validationPassed: boolean;
  failureReason: string | null;
  breakdown: SmartMarkBreakdownItem[];
  createdAt: string;
}

export interface HumanMarkView {
  id: string;
  markerId: string;
  marksAwarded: number;
  perPointDecisions: Record<string, number> | null;
  comments: string | null;
  createdAt: string;
}

export interface AnswerMarkingView {
  answerId: string;
  attemptId: string;
  learnerId: string;
  learnerDisplayName: string | null;
  questionId: string;
  questionExternalRef: string | null;
  partLabel: string;
  partPrompt: string;
  partMarks: number;
  answerText: string;
  markingState: string;
  marksAwarded: number | null;
  latestSmartMark: SmartMarkView | null;
  latestHumanMark: HumanMarkView | null;
}

export interface KappaEvaluationView {
  id: string;
  scope: string;
  paperId: string | null;
  sampleSize: number;
  kappa: number;
  observedAgreement: number;
  threshold: number;
  passed: boolean;
  computedAt: string;
}

// ── Attempt history (Review Hub minimal slice, mirrors core AttemptHistoryView) ──

/** One written part of a structured attempt: labels and mark outcome only. */
export interface AttemptHistoryPartView {
  partId: string;
  label: string;
  marksPossible: number;
  marksAwarded: number | null;
  markingState: string;
}

/** One past attempt — a read over the immutable evidence rows. */
export interface AttemptHistoryItem {
  attemptId: string;
  questionId: string;
  questionType: string;
  externalRef: string | null;
  commandWord: string | null;
  stemExcerpt: string;
  marksTotal: number;
  topicNodeId: string;
  topicCode: string | null;
  topicTitle: string | null;
  /** null for structured attempts pending authoritative marking */
  correct: boolean | null;
  /** null while marking is pending */
  marksAwarded: number | null;
  markingState: string;
  evidenceEmitted: boolean;
  chosenOptionLabel: string | null;
  correctOptionLabel: string | null;
  implicatedMisconceptionIds: string[];
  selfDoubtFlag: boolean;
  timedCondition: boolean;
  confidenceLevel: number | null;
  responseTimeMs: number;
  attemptedAt: string;
  parts: AttemptHistoryPartView[];
}

/** GET /api/v1/learners/me/attempts response. */
export interface AttemptHistoryView {
  learnerId: string;
  total: number;
  returned: number;
  attempts: AttemptHistoryItem[];
}

// ── T-033: next-best-learning-action read model (ADR-017 nba-rules/v1) ──

export type NextBestActionType =
  | "REVIEW_TOPIC"
  | "PRACTISE_QUESTIONS"
  | "REVIEW_PREREQUISITE"
  | "RETRY_PROBLEM_QUESTION"
  | "ASK_TUTOR"
  | "TIMED_EXERCISE"
  | "REMEDIATE_MISCONCEPTION";

export type NextBestReasonCode =
  | "DUE_REVIEW"
  | "PREREQUISITE_WEAK"
  | "VALIDATED_PREREQUISITE_CHAIN"
  | "PROBLEM_QUESTION"
  | "MISCONCEPTION_SUSPECTED"
  | "MISCONCEPTION_REMEDIATION"
  | "FLUENCY_GAP"
  | "LOW_MASTERY"
  | "UNCOVERED_TOPIC";

/** One ranked, evidence-backed learning action. Advice derived from measured
 *  evidence — deliberately distinct from the dashboard's measured-fact cards. */
export interface NextBestActionView {
  rank: number;
  actionType: NextBestActionType;
  reasonCode: NextBestReasonCode;
  targetNodeId: string;
  targetCode: string;
  targetTitle: string;
  /** present only for RETRY_PROBLEM_QUESTION */
  questionId: string | null;
  /** validated questions currently mapped to the target topic (0 ⇒ honest empty state) */
  servableQuestionCount: number;
  /** deterministic, evidence-derived explanation (never an invented claim) */
  reasonDetail: string;
}

export interface NextBestActionsView {
  learnerId: string;
  rootId: string;
  asOf: string;
  policy: string;
  actions: NextBestActionView[];
}

/** ── Teacher concept graph (V15): the seeded 4CH1 curriculum + settled T-C11 layer ── */

/** Result of POST /api/v1/teacher/concept-graph/activate — deterministic, idempotent. */
export interface ConceptGraphSeedSummary {
  curriculumVersionId: string;
  subjectId: string;
  rootNodeId: string;
  sections: number;
  subsections: number;
  specPoints: number;
  practicals: number;
  conceptNodes: number;
  validatedSemanticEdges: number;
  nodesCreated: number;
  nodesReused: number;
  edgesCreated: number;
  edgesReused: number;
  alreadyActive: boolean;
}

/** A node referenced from a semantic edge (id + display identity + status). */
export interface ConceptGraphNodeRef {
  nodeId: string;
  code: string;
  title: string;
  nodeType: string;
  validationStatus: string;
}

/** One graph-derived conceptual relationship (prerequisite, remediation, …).
 *  Distinct from the official curriculum anchor: the relation and provenance
 *  keep the graph's T-C11 origin visible. */
export interface ConceptGraphEdgeView {
  source: ConceptGraphNodeRef;
  target: ConceptGraphNodeRef;
  relation: string;
  validationStatus: string;
  provenance: string | null;
  rationale: string | null;
}

export interface ConceptGraphEdgesView {
  rootId: string;
  rootCode: string;
  policy: string;
  edges: ConceptGraphEdgeView[];
}

/** ── Teacher content validation (Master Spec §7) + learner papers browsing ── */

/** A paper in the teacher validation queue (POST-ingest everything is SUGGESTED). */
export interface TeacherPaperSummary {
  id: string;
  subjectId: string | null;
  title: string;
  paperCode: string | null;
  sessionLabel: string | null;
  board: string | null;
  qualification: string | null;
  validationState: string;
}

/**
 * V20 enriched queue entry: the same SUGGESTED paper plus the quality signals a
 * reviewer triages by (progress, bridge reconciliation, parser findings, mean
 * extraction confidence). Server-sorted strongest-candidates-first.
 */
export interface TeacherEnrichedPaperSummary extends TeacherPaperSummary {
  versionCount: number;
  validatedVersions: number;
  rejectedVersions: number;
  flaggedVersions: number;
  suggestedSchemes: number;
  reconciliationStatus: string | null;
  findingCount: number;
  avgExtractionConfidence: number | null;
  createdAt: string;
}

export interface TeacherEnrichedReviewQueueView {
  papers: TeacherEnrichedPaperSummary[];
  suggestedVersions: number;
  suggestedSchemes: number;
}

export interface TeacherReviewQueueView {
  papers: TeacherPaperSummary[];
  suggestedVersions: number;
  suggestedSchemes: number;
}

/** One parser/bridge review finding (reconciliation + warnings) for a paper. */
export interface TeacherFindingView {
  source: string | null;
  severity: string | null;
  detail: string | null;
  [key: string]: unknown;
}

/** Result of POST .../exam-papers/{id}/validate-all (BatchResult). */
export interface TeacherValidateAllResult {
  paperId: string;
  paperState: string;
  totalVersions: number;
  versionsValidated: number;
  schemesValidated: number;
}

/** §10 topic mapping: result of POST .../questions/{id}/topics. */
export interface TeacherTopicMappingResult {
  questionId: string;
  primaryNodeId: string;
  primaryCode: string;
  primaryTitle: string;
  topicCount: number;
}

/** One row of a question's current topic mapping (GET .../questions/{id}/topics). */
export interface TeacherTopicRowView {
  nodeId: string;
  primary: boolean;
  code: string | null;
  title: string | null;
}

/** Teacher-only: the deterministic marking contract per mark point. */
export interface TeacherPointReview {
  id: string;
  ref: string | null;
  text: string;
  marks: number;
  acceptanceCriteria: string[];
}

/** Teacher-only: includes the correct flag and the misconception a distractor feeds. */
export interface TeacherOptionReview {
  id: string;
  label: string;
  text: string;
  correct: boolean;
  misconceptionNodeId: string | null;
}

export interface TeacherPartReview {
  id: string;
  label: string;
  prompt: string;
  commandWord: string | null;
  marks: number;
}

/** One question version with its full review payload (content + answer key + scheme). */
export interface TeacherVersionReview {
  versionId: string;
  questionId: string;
  externalRef: string | null;
  type: string;
  stem: string;
  marks: number;
  version: number;
  validationState: string;
  commandWord: string | null;
  schemeId: string | null;
  schemeState: string | null;
  points: TeacherPointReview[];
  options: TeacherOptionReview[];
  parts: TeacherPartReview[];
  extractionConfidence: number | null;
  extractionMethod: string | null;
  sourceDocumentId: string | null;
}

export interface TeacherPaperReviewView {
  paper: {
    id: string;
    subjectId: string | null;
    title: string;
    paperCode: string | null;
    sessionLabel: string | null;
    board: string | null;
    qualification: string | null;
    validationState: string;
  };
  versions: TeacherVersionReview[];
}

/** Result of POST .../question-versions/{id}/validate|reject (VersionSummary). */
export interface TeacherVersionActionResult {
  id: string;
  questionId: string;
  version: number;
  validationState: string;
}

/** Result of POST .../mark-schemes/{id}/validate|reject (SchemeSummary). */
export interface TeacherSchemeActionResult {
  id: string;
  questionVersionId: string;
  pointCount: number;
  validationState: string;
}

/** Learner-facing paper metadata (no question content — serving stays gated). */
export interface ExamPaperBrowseView {
  id: string;
  /** subject scoping (null = unassigned) — lets surfaces split papers by subject */
  subjectId: string | null;
  title: string;
  board: string | null;
  qualification: string | null;
  unit: string | null;
  sessionLabel: string | null;
  paperCode: string | null;
  validationState: string;
  provenance: string;
  questionPaperDocumentId: string | null;
  markSchemeDocumentId: string | null;
}

export interface ExamPaperQuestionMeta {
  questionId: string;
  externalRef: string | null;
  marks: number;
  provenance: string;
  versionValidationState: string | null;
  partCount: number;
  currentVersionId: string | null;
}

export interface ExamPaperDetailView {
  paper: ExamPaperBrowseView;
  questions: ExamPaperQuestionMeta[];
}

// ── P9 Test Builder (mirrors core TestBuilderService.TestPreviewView) ──

/** V22: one durable audit row (who decided what, when, from/to states) */
export interface TeacherAuditRowView {
  occurredAt: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  fromState: string | null;
  toState: string | null;
  detail: string;
}

export interface TestPreviewView {
  rootId: string;
  questionCount: number;
  totalMarks: number;
  targetMarks: number | null;
  topics: TestTopicCoverage[];
  questions: TestQuestionView[];
}

export interface TestTopicCoverage {
  topicNodeId: string;
  code: string;
  title: string;
  servableQuestions: number;
}

export interface TestQuestionView {
  id: string;
  type: string;
  stem: string;
  marks: number;
  commandWord: string | null;
  difficulty: number;
  topicCode: string | null;
  parts: { id: string; label: string; prompt: string; commandWord: string | null; marks: number }[];
  options: { id: string; label: string; text: string }[];
  answers: TestAnswerView[];
  schemeState: string | null;
}

export interface TestAnswerView {
  partLabel: string | null;
  ref: string | null;
  text: string;
  marks: number;
  acceptanceCriteria: string[];
}

// ── Teacher class intelligence (productization sprint 2 §2–§5; mirrors core
// ClassAnalyticsService view records; policy class-analytics/v1) ──

/** One heatmap cell: topic × class evidence and mastery (null = unmeasured). */
export interface ClassTopicAggregate {
  nodeId: string;
  code: string;
  title: string;
  parentCode: string | null;
  parentTitle: string | null;
  learnersMeasured: number;
  meanMastery: number | null;
  masteryBand: "LOW" | "DEVELOPING" | "SECURE" | "UNMEASURED";
  evidenceBackedAttempts: number;
  learnersWithActiveMisconception: number;
  activeMisconceptionSignals: number;
  tutorEngagements: number;
  dueReviews: number;
  servableQuestions: number;
}

/** A prerequisite the class measures weak, with the dependents that need it. */
export interface ClassWeakPrerequisite {
  prerequisiteNodeId: string;
  prerequisiteCode: string;
  prerequisiteTitle: string;
  learnersMeasured: number;
  meanMastery: number | null;
  masteryBand: string;
  dependents: { nodeId: string; code: string; title: string; meanMastery: number | null }[];
}

export interface ClassRecentActivity {
  recentAttempts: number;
  learnersActive: number;
  tutorAsks: number;
  structuredAnswersPendingMarking: number;
  windowStart: string;
}

export interface ClassOverviewView {
  rootId: string;
  rootCode: string;
  policy: string;
  enrolledLearners: number;
  learnersWithEvidence: number;
  learnersRecentlyActive: number;
  totalTopics: number;
  measuredTopics: number;
  topics: ClassTopicAggregate[];
  weakPrerequisites: ClassWeakPrerequisite[];
  recentActivity: ClassRecentActivity;
}

/** One learner row — evidence kinds stay separated; nulls mean unmeasured. */
export interface ClassLearnerRow {
  learnerId: string;
  displayName: string;
  createdAt: string;
  evidenceState: "MEASURED" | "UNMEASURED";
  topicsMeasured: number;
  meanMastery: number | null;
  evidenceBackedAttempts: number;
  recentAttempts: number;
  recentCorrect: number;
  lastActivityAt: string | null;
  weakestTopics: {
    nodeId: string;
    code: string;
    title: string;
    mastery: number;
    band: string;
    attempts: number;
  }[];
  activeMisconceptions: number;
  misconceptionSignals: {
    misconceptionNodeId: string;
    code: string;
    title: string;
    probability: number;
    evidenceCount: number;
    parentTopicNodeId: string | null;
    parentTopicCode: string | null;
  }[];
  tutorEngagements: number;
  tutorSignalCounts: Record<string, number>;
  lastTutorEngagementAt: string | null;
  dueReviews: number;
}

/** §5 drill-down: class → topic → learners → evidence → intervention. */
export interface ClassTopicDrillDown {
  rootId: string;
  topic: ClassTopicAggregate;
  prerequisiteChain: {
    nodeId: string;
    code: string;
    title: string;
    depth: number;
    learnersMeasured: number;
    meanMastery: number | null;
    masteryBand: string;
  }[];
  affectedLearners: {
    learnerId: string;
    displayName: string;
    mastery: number | null;
    reason: "LOW_MASTERY" | "ACTIVE_MISCONCEPTION" | "LOW_MASTERY_AND_ACTIVE_MISCONCEPTION";
    misconceptions: {
      misconceptionNodeId: string;
      code: string;
      title: string;
      probability: number;
      evidenceCount: number;
      parentTopicNodeId: string | null;
      parentTopicCode: string | null;
    }[];
  }[];
  representativeEvidence: {
    attemptId: string;
    learnerId: string;
    learnerDisplayName: string;
    questionId: string;
    questionRef: string | null;
    correct: boolean;
    marksAwarded: number | null;
    questionMarks: number;
    markingState: string;
    createdAt: string;
  }[];
  servableQuestions: {
    id: string;
    externalRef: string;
    type: string;
    marks: number;
    difficulty: number;
  }[];
}
