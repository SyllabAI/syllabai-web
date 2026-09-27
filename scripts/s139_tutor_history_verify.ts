/**
 * s139 runtime verification — the Tutor working-memory history builder against
 * the REAL module (src/components/syllabai/TutorChatView.tsx), the same
 * posture as s138's chat-markdown verification: import the shipped code, not a
 * copy. Run: bun scripts/s139_tutor_history_verify.ts
 *
 * Checks the contract the backend relies on:
 *  1. plain follow-up: prior user + assistant turns ride, oldest first;
 *  2. refusals are honest assistant turns (their text goes as history);
 *  3. error bubbles NEVER become history (UI chrome, not conversation);
 *  4. retry dedup: the trailing user bubble matching the retried question is
 *     dropped so the turn is not duplicated; an earlier identical question
 *     asked genuinely twice in a row is KEPT;
 *  5. the 8-turn client cap holds (server re-caps at 12);
 *  6. empty transcript → empty history (first ask stays single-turn).
 */
import { historyFor } from "../src/components/syllabai/TutorChatView";
import type { TutorChatMessage } from "../src/components/syllabai/TutorChatView";
import type { TutorAnswerView } from "../src/lib/types";

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const answer = (text: string): TutorAnswerView => ({
  answer: text,
  citations: [],
  topics: [],
  evidenceCount: 0,
  model: "m",
  provider: "p",
  refused: false,
  latencyMs: 1,
});
const refused = (text: string): TutorAnswerView => ({ ...answer(text), refused: true });

// 1. plain follow-up
const plain: TutorChatMessage[] = [
  { kind: "user", text: "How do I calculate moles from mass and Mr?", at: 1 },
  { kind: "assistant", result: answer("Divide mass by Mr [1]."), at: 2 },
];
const h1 = historyFor(plain, "why is that?");
check("follow-up carries prior turns, oldest first, user+assistant",
  h1.length === 2 && h1[0].role === "user" && h1[0].text.includes("moles")
    && h1[1].role === "assistant" && h1[1].text.includes("mass by Mr"),
  JSON.stringify(h1));

// 2. refusal is an honest turn
const h2 = historyFor(
  [{ kind: "user", text: "what is chromatography?", at: 1 },
   { kind: "assistant", result: refused("I can't answer that from the validated course material."), at: 2 }],
  "are you sure?");
check("refusals ride as assistant turns",
  h2.length === 2 && h2[1].role === "assistant" && h2[1].text.includes("can't answer"),
  JSON.stringify(h2));

// 3. error bubbles excluded
const h3 = historyFor(
  [{ kind: "user", text: "q1", at: 1 },
   { kind: "error", text: "network down", question: "q1", at: 2 },
   { kind: "assistant", result: answer("a1"), at: 3 }],
  "next?");
check("error bubbles never become history",
  h3.length === 2 && h3.every((t) => t.text !== "network down"),
  JSON.stringify(h3));

// 4. retry dedup: trailing identical user bubble dropped…
const retry: TutorChatMessage[] = [
  { kind: "user", text: "explain moles", at: 1 },
  { kind: "assistant", result: answer("moles are units [1]."), at: 2 },
  { kind: "user", text: "explain moles", at: 3 }, // the failed optimistic bubble
  { kind: "error", text: "timeout", question: "explain moles", at: 4 },
];
const h4 = historyFor(retry, "explain moles");
check("retry drops the trailing duplicate user turn",
  h4.length === 2 && h4[0].role === "user" && h4[1].role === "assistant",
  JSON.stringify(h4));

// …but a question genuinely repeated twice (answered in between) is kept
const repeated: TutorChatMessage[] = [
  { kind: "user", text: "explain moles", at: 1 },
  { kind: "assistant", result: answer("first answer"), at: 2 },
  { kind: "user", text: "explain moles", at: 3 }, // genuinely asked AGAIN
];
const h5 = historyFor(repeated, "and bonding?");
check("genuine repeat questions are kept",
  h5.length === 3 && h5.filter((t) => t.role === "user").length === 2,
  JSON.stringify(h5));

// 5. the 8-turn cap
const long: TutorChatMessage[] = [];
for (let i = 0; i < 10; i++) {
  long.push({ kind: "user", text: `q${i}`, at: i });
  long.push({ kind: "assistant", result: answer(`a${i}`), at: i + 0.5 });
}
const h6 = historyFor(long, "final?");
check("history capped at 8 newest turns (server re-caps at 12)",
  h6.length === 8 && h6[0].text === "q6" && h6[7].text === "a9",
  `len=${h6.length} first=${h6[0]?.text} last=${h6[7]?.text}`);

// 6. empty transcript
const h7 = historyFor([], "first question?");
check("empty transcript → empty history (first ask is single-turn)", h7.length === 0);

console.log(`\n${passed}/${passed + failed} checks pass`);
if (failed > 0) {
  process.exit(1);
}
