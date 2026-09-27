/**
 * s140 runtime verification — the §22 session hydration mapping against the
 * REAL module (src/components/syllabai/TutorChatView.tsx), same posture as
 * s139's history verification: import the shipped code, not a copy.
 * Run: bun scripts/s140_tutor_session_verify.ts
 *
 * Checks the contract the backend's TutorSessionTurnView implies:
 *  1. user turns map back to user bubbles verbatim;
 *  2. assistant turns map back with the honest §19 footer fields
 *     (model/provider/latency/evidence count) and NO reconstructed
 *     citations — restored prose only, the archive stays in telemetry;
 *  3. null-footer turns degrade honestly (provider "restored", latency 0);
 *  4. refusals restore as refusals;
 *  5. a full stored exchange hydrates into a renderable transcript whose
 *     historyFor() output round-trips (restored chats keep working memory).
 */
import { historyFor, restoredMessage } from "../src/components/syllabai/TutorChatView";
import type { TutorSessionTurnView } from "../src/lib/types";

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

const turn = (over: Partial<TutorSessionTurnView>): TutorSessionTurnView => ({
  seq: 1,
  role: "user",
  content: "text",
  evidenceCount: 0,
  refused: false,
  model: null,
  provider: null,
  latencyMs: null,
  at: new Date("2026-09-27T10:00:00Z").toISOString(),
  ...over,
});

// 1. user turns verbatim
const u = restoredMessage(turn({ role: "user", content: "what is a mole?" }));
check("user turn maps to a user bubble, verbatim",
  u.kind === "user" && u.text === "what is a mole?",
  JSON.stringify(u));

// 2. assistant turn keeps the §19 footer, no fabricated citations
const a = restoredMessage(turn({
  seq: 2, role: "assistant", content: "A mole is an amount of substance.",
  evidenceCount: 3, model: "llama-3.3-70b", provider: "groq", latencyMs: 812.5,
}));
check("assistant turn restores with its traceability footer",
  a.kind === "assistant" && a.result.model === "llama-3.3-70b"
    && a.result.provider === "groq" && a.result.latencyMs === 812.5
    && a.result.evidenceCount === 3,
  JSON.stringify(a));
check("restored answers carry no fabricated citations",
  a.kind === "assistant" && a.result.citations.length === 0 && a.result.topics.length === 0,
  JSON.stringify(a));

// 3. null footer fields degrade honestly
const sparse = restoredMessage(turn({ seq: 4, role: "assistant", content: "old answer" }));
check("null footer fields degrade to provider=restored, latency 0",
  sparse.kind === "assistant" && sparse.result.provider === "restored"
    && sparse.result.latencyMs === 0 && sparse.result.model === null,
  JSON.stringify(sparse));

// 4. refusals restore as refusals
const refused = restoredMessage(turn({ seq: 6, role: "assistant", content: "I can't answer…", refused: true }));
check("refused turns restore with the refusal flag",
  refused.kind === "assistant" && refused.result.refused === true,
  JSON.stringify(refused));

// 5. a stored exchange round-trips into working memory
const stored: TutorSessionTurnView[] = [
  turn({ seq: 1, role: "user", content: "How do I calculate moles from mass and Mr?" }),
  turn({ seq: 2, role: "assistant", content: "Divide mass by Mr.", evidenceCount: 2,
         model: "m", provider: "groq", latencyMs: 700 }),
];
const hydrated = stored.map(restoredMessage);
const history = historyFor(hydrated, "why is that?");
check("hydrated transcript feeds working memory (follow-ups work after refresh)",
  history.length === 2 && history[0].role === "user"
    && history[0].text.includes("mass and Mr")
    && history[1].role === "assistant" && history[1].text === "Divide mass by Mr.",
  JSON.stringify(history));

console.log(`\n${passed}/${passed + failed} checks pass`);
if (failed > 0) {
  process.exit(1);
}
