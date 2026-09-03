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
