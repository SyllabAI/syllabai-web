/**
 * s143 runtime verification — the conversation-pane contracts against the
 * REAL module (src/components/syllabai/TutorChatView.tsx), same posture as
 * s139/s140: import the shipped code, not a copy.
 * Run: bun scripts/s143_conversation_list_verify.ts
 *
 * Checks the contract the backend's SessionSummaryView implies:
 *  1. a titled conversation shows the server-derived title (the opening
 *     question) verbatim;
 *  2. null / empty / whitespace-only titles fall back to the honest
 *     "Empty conversation" — never a blank row or "null";
 *  3. the turn-count label is honest for 0, 1 and many stored turns
 *     (turnCount counts ROWS: one exchange = 2 turns);
 *  4. the full round-trip the pane depends on: a stored exchange hydrates
 *     via restoredMessage into a transcript whose historyFor() output
 *     round-trips — resuming an old conversation keeps working memory
 *     (s139 contract, re-asserted for the switching path).
 */
import { conversationTitle, historyFor, restoredMessage, turnsLabel } from "../src/components/syllabai/TutorChatView";
import type { TutorSessionSummary, TutorSessionTurnView } from "../src/lib/types";

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

const summary = (over: Partial<TutorSessionSummary>): TutorSessionSummary => ({
  sessionId: "b7e0f4c2-0000-4000-8000-000000000001",
  createdAt: "2026-09-27T09:00:00Z",
  lastActiveAt: "2026-09-27T09:05:00Z",
  turnCount: 2,
  title: "How do I balance a redox half-equation?",
  ...over,
});

// 1. titled conversations show the derived title verbatim
check("titled conversation renders the server-derived title",
  conversationTitle(summary({})) === "How do I balance a redox half-equation?");

check("a 120-char title passes through untouched (bound is server-side)",
  conversationTitle(summary({ title: "x".repeat(120) })) === "x".repeat(120));

// 2. the honest fallback — never a blank row
check("null title falls back to 'Empty conversation'",
  conversationTitle(summary({ title: null })) === "Empty conversation");
check("empty-string title falls back",
  conversationTitle(summary({ title: "" })) === "Empty conversation");
check("whitespace-only title falls back",
  conversationTitle(summary({ title: "   \n\t " })) === "Empty conversation");

// 3. turn-count labels for the pane's meta line
check("zero stored turns label honestly",
  turnsLabel(0) === "0 turns");
check("exactly one stored turn is singular",
  turnsLabel(1) === "1 turn");
check("a full exchange is 2 turns, plural",
  turnsLabel(2) === "2 turns");
check("a long chat labels with the count",
  turnsLabel(17) === "17 turns");

// 4. resuming keeps working memory: stored exchange → hydrated transcript →
//    history rides the next ask (the s139 contract on the s143 switching path)
const storedExchange: TutorSessionTurnView[] = [
  {
    seq: 1, role: "user", content: "what is a mole?",
    evidenceCount: 0, refused: false, model: null, provider: null, latencyMs: null,
    at: "2026-09-27T09:00:00Z",
  },
  {
    seq: 2, role: "assistant", content: "A mole is an amount of substance.",
    evidenceCount: 4, refused: false, model: "llama-3.3-70b", provider: "groq", latencyMs: 812.5,
    at: "2026-09-27T09:00:05Z",
  },
];
const hydrated = storedExchange.map(restoredMessage);
check("a stored exchange hydrates into a 2-message transcript",
  hydrated.length === 2 && hydrated[0].kind === "user" && hydrated[1].kind === "assistant");
const followUp = historyFor(hydrated, "and how do I convert it to particles?");
check("the follow-up ask carries the resumed conversation as history",
  followUp.length === 2 &&
    followUp[0].role === "user" && followUp[0].text === "what is a mole?" &&
    followUp[1].role === "assistant" && followUp[1].text === "A mole is an amount of substance.",
  JSON.stringify(followUp));

// summary — one line, greppable, same shape as the s139/s140/s142 scripts
if (failed === 0) {
  console.log(`s143 conversation-list verification: ALL ${passed} CHECKS PASS`);
} else {
  console.log(`s143 conversation-list verification: ${failed} FAILED / ${passed} passed`);
  process.exit(1);
}
