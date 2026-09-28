/**
 * MockProvider — the default hermetic data source.
 *
 * Serves the REAL imported SyllabAI content committed under content/
 * (imported from SyllabAI/syllabai-resources by scripts/import_content.py —
 * see that script for provenance). Canonical ids (rn_*, qstn_*, 4CH1-*) are
 * preserved exactly as they exist upstream.
 */
import manifestJson from "../../../content/igcse-chemistry-19/manifest.json";
import curriculumJson from "../../../content/igcse-chemistry-19/curriculum.json";
import conceptGraphJson from "../../../content/igcse-chemistry-19/concept-graph.json";
import notesJson from "../../../content/igcse-chemistry-19/notes.json";
import questionsJson from "../../../content/igcse-chemistry-19/questions.json";
import flashcardsJson from "../../../content/igcse-chemistry-19/flashcards.json";
import learnerJson from "../../../content/igcse-chemistry-19/learner-sim.json";
import { z } from "zod";
import {
  ContentManifest,
  Curriculum,
  ConceptGraph,
  ExamQuestionTopic,
  Flashcard,
  RevisionNote,
  SimLearnerState,
} from "@/lib/contracts";
import type { DemoDataProvider } from "./types";

const manifest = ContentManifest.parse(manifestJson);
const curriculum = Curriculum.parse(curriculumJson);
const conceptGraph = ConceptGraph.parse(conceptGraphJson);
const notes = z.array(RevisionNote).parse(notesJson) as RevisionNote[];
const questionTopics = z.array(ExamQuestionTopic).parse(questionsJson) as ExamQuestionTopic[];
const flashcards = z.array(Flashcard).parse(flashcardsJson) as Flashcard[];
const simLearner = SimLearnerState.parse(learnerJson) as SimLearnerState;

export function mockProvider(): DemoDataProvider {
  return {
    id: "mock",
    displayName: "Bundled corpus (real import)",
    detail: `syllabai-resources@${manifest.importSource.ref} · 4CH1 · generated ${manifest.generatedUtc.slice(0, 10)}`,
    manifest: async () => manifest,
    curriculum: async () => curriculum,
    conceptGraph: async () => conceptGraph,
    revisionNotes: async () => notes,
    examQuestionTopics: async () => questionTopics,
    flashcards: async () => flashcards,
    simLearnerState: async () => simLearner,
  };
}
