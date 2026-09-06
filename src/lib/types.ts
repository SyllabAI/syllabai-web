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
}

export interface MisconceptionStateView {
  misconceptionNodeId: string;
  probability: number;
  active: boolean;
  evidenceCount: number;
  lastEvidenceAt: string;
}

export interface ReviewView {
  nodeId: string;
  dueAt: string;
  reason: string;
}

export interface LearnerStateView {
  learnerId: string;
  skillStates: SkillStateView[];
  misconceptionStates: MisconceptionStateView[];
  pendingReviews: ReviewView[];
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
export interface LearnerKnowledgeGraphView {
  learnerId: string;
  rootId: string;
  rootCode: string;
  rootTitle: string;
  asOf: string;
  nodes: LearnerNodeWithStateView[];
  prerequisiteEdges: LearnerPrerequisiteEdgeView[];
}
