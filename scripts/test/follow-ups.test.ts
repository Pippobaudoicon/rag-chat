/**
 * Pure tests for cleaning suggested follow-up questions.
 *
 * Run: `pnpm run test:follow-ups`
 */
import { MAX_FOLLOW_UP_LENGTH, normalizeFollowUps } from "@/lib/chat/follow-ups";

let failures = 0;
let total = 0;
const check = (label: string, ok: boolean) => {
  total += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

check("non-array output gives no suggestions", same(normalizeFollowUps("a question?"), []));
check(
  "list markers, quotes and extra spaces are removed",
  same(normalizeFollowUps(["1. What is faith?", "- \"Where is it  taught?\"", "• «Come applicarlo?»"]), [
    "What is faith?",
    "Where is it taught?",
    "Come applicarlo?",
  ])
);
check(
  "empty, non-string, over-long and repeated entries are dropped",
  same(
    normalizeFollowUps(["", 3, "x".repeat(MAX_FOLLOW_UP_LENGTH + 1), "Why?", "why?", "How?"]),
    ["Why?", "How?"]
  )
);
check(
  "a suggestion equal to the user's question is dropped",
  same(normalizeFollowUps(["What is grace?", "Where is grace taught?"], " what is grace? "), [
    "Where is grace taught?",
  ])
);
check(
  "at most three suggestions",
  normalizeFollowUps(["A?", "B?", "C?", "D?"]).length === 3
);

console.log(`\n${total - failures}/${total} passed`);
if (failures > 0) process.exit(1);
