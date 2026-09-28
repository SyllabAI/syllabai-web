/**
 * DemoDataProvider — the swappable data-source seam (brief §16).
 *
 * Every surface talks to this interface only; experiments can switch data
 * sources without rewriting UI:
 *
 *   MockProvider    — bundled, real imported SyllabAI content (default, hermetic)
 *   NeonProvider    — same shapes served from Neon PostgreSQL via Drizzle
 *   CoreApiProvider — pass-through to the authoritative syllabai-core REST API
 *
 * READ MODELS ONLY: none of these providers may write canonical educational
 * truth. Learner-ish writes are confined to the SIMULATED overlay.
 */
import type {
  ConceptGraph,
  Curriculum,
  ContentManifest,
  ExamQuestionTopic,
  Flashcard,
  RevisionNote,
  SimLearnerState,
} from "@/lib/contracts";

export interface DemoDataProvider {
  readonly id: "mock" | "neon" | "core-api";
  readonly displayName: string;
  readonly detail: string;

  manifest(): Promise<ContentManifest>;
  curriculum(): Promise<Curriculum>;
  conceptGraph(): Promise<ConceptGraph>;
  revisionNotes(): Promise<RevisionNote[]>;
  examQuestionTopics(): Promise<ExamQuestionTopic[]>;
  flashcards(): Promise<Flashcard[]>;
  simLearnerState(): Promise<SimLearnerState>;
}
