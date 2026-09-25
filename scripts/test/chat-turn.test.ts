/**
 * Pure tests for the per-turn helpers used by POST /api/chat.
 *
 * Run: `pnpm run test:chat-turn`
 */
import { chunkCachedText } from "@/lib/chat/cached-replay";
import {
  findRegenerateTarget,
  getToolNames,
  toRetrievalToolEvent,
  uniqueSources,
  usageDetails,
  userTurnIndexBefore,
} from "@/lib/chat/turn";
import type { SourceChunk } from "@/lib/types";

let failures = 0;
let total = 0;
const check = (label: string, ok: boolean) => {
  total += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// getToolNames
check(
  "tool names are distinct, in first-call order",
  same(
    getToolNames([
      { toolCalls: [{ toolName: "semantic_search" }, { toolName: "lookup_scripture_passage" }] },
      { toolCalls: [{ toolName: "semantic_search" }, { toolName: "citation_verifier" }] },
    ]),
    ["semantic_search", "lookup_scripture_passage", "citation_verifier"]
  )
);
check(
  "tool names skip malformed calls and blank names",
  same(getToolNames([{ toolCalls: [null, "x", { toolName: "  " }, { toolName: 3 }] }, {}]), [])
);

// uniqueSources
const chunk = (id: string) => ({ id }) as SourceChunk;
check(
  "sources keep the first occurrence of each id",
  same(uniqueSources([chunk("a"), chunk("b"), chunk("a"), chunk("c")], 10).map((c) => c.id), ["a", "b", "c"])
);
check(
  "sources are capped after de-duplication",
  same(uniqueSources([chunk("a"), chunk("a"), chunk("b"), chunk("c")], 2).map((c) => c.id), ["a", "b"])
);

// findRegenerateTarget / userTurnIndexBefore
const stored = [
  { id: 1, role: "user", content: "q1" },
  { id: 2, role: "assistant", content: "a1" },
  { id: 3, role: "user", content: "q2" },
  { id: 4, role: "assistant", content: "a2" },
];
check("regenerate targets the named assistant message", findRegenerateTarget(stored, "2")?.id === 2);
check("regenerate accepts a numeric message id", findRegenerateTarget(stored, 2)?.id === 2);
check("regenerate falls back to the latest assistant for a user id", findRegenerateTarget(stored, 3)?.id === 4);
check("regenerate falls back to the latest assistant for a client id", findRegenerateTarget(stored, "msg_abc")?.id === 4);
check("regenerate has no target without assistant messages", findRegenerateTarget(stored.slice(0, 1), "1") === null);
check("user turn before an answer", userTurnIndexBefore(stored, 4) === 2);
check("user turn before the first answer", userTurnIndexBefore(stored, 2) === 0);
check("no user turn before the first message", userTurnIndexBefore(stored, 1) === -1);
check("no user turn for an unknown id", userTurnIndexBefore(stored, 99) === -1);

// usageDetails
check(
  "usage maps to message details",
  same(
    usageDetails({ inputTokens: 10, outputTokens: 5, totalTokens: 15, outputTokenDetails: { reasoningTokens: 2 } }),
    { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 2 }
  )
);
check(
  "missing usage stays undefined",
  Object.values(usageDetails({})).every((value) => value === undefined)
);

// toRetrievalToolEvent
check(
  "tool progress keeps only retrieval-trace fields",
  same(
    toRetrievalToolEvent({ phase: "tools", toolName: "semantic_search", sourceCount: 4, cacheHit: true, elapsedMs: 12, conversationId: "c" }),
    { toolName: "semantic_search", sourceCount: 4, cacheHit: true, elapsedMs: 12 }
  )
);

// chunkCachedText
check("cached text replays in 3-word chunks", same(chunkCachedText("one two three four five"), ["one two three ", "four five"]));
check("cached replay preserves the full text", chunkCachedText("a  b\nc d. e").join("") === "a  b\nc d. e");
check("empty cached text has no chunks", chunkCachedText("").length === 0);

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
