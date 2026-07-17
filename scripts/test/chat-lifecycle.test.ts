/**
 * Pure regression tests for navigation-safe chat generation state.
 *
 * Run: `npm run test:chat-lifecycle`
 */
import {
  CHAT_GENERATION_PENDING_STALE_AFTER_MS,
  CHAT_GENERATION_STALE_AFTER_MS,
  isChatGenerationActive,
  isChatGenerationStale,
  matchesChatGenerationSnapshot,
  resolvePersistedUserTurn,
  shouldCommitGeneration,
  shouldResumeChatStream,
} from "@/lib/chat/generation";
import {
  CHAT_GENERATION_CLAIM_TIMEOUT_MS,
  CHAT_GENERATION_TRANSPORT_ERROR_GRACE_MS,
  isGenerationClaimTimedOut,
  mergeRefreshedConversationFirstPage,
  shouldAutoFocusNewChatComposer,
  shouldFailGenerationClaim,
  shouldShowPendingAssistant,
} from "@/lib/chat/client-lifecycle";

let failures = 0;
let total = 0;
const check = (label: string, ok: boolean) => {
  total += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

check("streaming is active", isChatGenerationActive("streaming"));
check("complete is not active", !isChatGenerationActive("complete"));
check("error is not active", !isChatGenerationActive("error"));

const now = Date.now();
check(
  "fresh generation is not stale",
  !isChatGenerationStale(
    "streaming",
    new Date(now - CHAT_GENERATION_STALE_AFTER_MS + 1),
    now
  )
);
check(
  "expired generation is stale",
  isChatGenerationStale(
    "streaming",
    new Date(now - CHAT_GENERATION_STALE_AFTER_MS - 1),
    now
  )
);
check(
  "completed generation never becomes stale",
  !isChatGenerationStale(
    "complete",
    new Date(now - CHAT_GENERATION_STALE_AFTER_MS * 2),
    now
  )
);
check(
  "unclaimed first turn uses the shorter stale window",
  isChatGenerationStale(
    "streaming",
    new Date(now - CHAT_GENERATION_PENDING_STALE_AFTER_MS - 1),
    now,
    true
  )
);

check(
  "active Redis stream is resumable",
  shouldResumeChatStream("streaming", "stream-1", true)
);
check(
  "polling fallback does not attempt resume",
  !shouldResumeChatStream("streaming", null, false)
);
check(
  "completed stream is not resumable",
  !shouldResumeChatStream("complete", "stream-1", true)
);

check("matching turn can commit", shouldCommitGeneration("turn-1", "turn-1"));
check("older turn cannot commit", !shouldCommitGeneration("turn-2", "turn-1"));
check(
  "stale recovery CAS matches the same active turn",
  matchesChatGenerationSnapshot("streaming", "turn-1", "turn-1")
);
check(
  "stale recovery CAS rejects a replacement turn",
  !matchesChatGenerationSnapshot("streaming", "turn-2", "turn-1")
);
check(
  "stale recovery CAS rejects a completed generation",
  !matchesChatGenerationSnapshot("complete", "turn-1", "turn-1")
);

const storedMessages = [
  { id: 1, role: "user", content: "Earlier question" },
  { id: 2, role: "assistant", content: "Earlier answer" },
  { id: 3, role: "user", content: "Current question" },
];
const resolved = resolvePersistedUserTurn(storedMessages, 3, "Current question");
check("pre-persisted first turn is recognized", resolved.currentMessage?.id === 3);
check(
  "current pre-persisted turn is excluded from model history",
  resolved.priorMessages.map((message) => message.id).join(",") === "1,2"
);
check(
  "mismatched persisted turn is rejected",
  resolvePersistedUserTurn(storedMessages, 3, "Different question").currentMessage === null
);
check(
  "an older identical user row cannot be reused",
  resolvePersistedUserTurn(
    [
      { id: 1, role: "user", content: "Repeated question" },
      { id: 2, role: "assistant", content: "Earlier answer" },
      { id: 3, role: "user", content: "Repeated question" },
    ],
    1,
    "Repeated question"
  ).currentMessage === null
);
check(
  "a persisted user id cannot be replayed after completion",
  resolvePersistedUserTurn(
    [
      { id: 3, role: "user", content: "Current question" },
      { id: 4, role: "assistant", content: "Current answer" },
    ],
    3,
    "Current question"
  ).currentMessage === null
);

check(
  "generation claim remains pending inside grace period",
  !isGenerationClaimTimedOut(
    now - CHAT_GENERATION_CLAIM_TIMEOUT_MS + 1,
    now
  )
);
check(
  "generation claim expires at bounded timeout",
  isGenerationClaimTimedOut(now - CHAT_GENERATION_CLAIM_TIMEOUT_MS, now)
);
check(
  "transport error keeps a short server-claim grace period",
  !shouldFailGenerationClaim(
    now - CHAT_GENERATION_TRANSPORT_ERROR_GRACE_MS + 1,
    true,
    now
  )
);
check(
  "transport error fails after its server-claim grace period",
  shouldFailGenerationClaim(
    now - CHAT_GENERATION_TRANSPORT_ERROR_GRACE_MS,
    true,
    now
  )
);

check(
  "pending assistant follows the newest user even with older answers",
  shouldShowPendingAssistant(
    [
      { role: "user" },
      { role: "assistant" },
      { role: "user" },
    ],
    true
  )
);
check(
  "pending assistant is not duplicated after an assistant message exists",
  !shouldShowPendingAssistant([{ role: "user" }, { role: "assistant" }], true)
);

check(
  "empty new chat requests post-paint composer focus",
  shouldAutoFocusNewChatComposer(undefined, 0, false)
);
check(
  "existing conversation does not request mobile autofocus",
  !shouldAutoFocusNewChatComposer("conversation-1", 0, false)
);
check(
  "hydrated messages do not request new-chat autofocus",
  !shouldAutoFocusNewChatComposer(undefined, 1, false)
);
check(
  "pending onboarding suppresses new-chat autofocus",
  !shouldAutoFocusNewChatComposer(undefined, 0, true)
);

const preservedPages = mergeRefreshedConversationFirstPage(
  [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }],
  [{ id: "new" }, { id: "1" }],
  2
);
check(
  "first-page refresh preserves already loaded conversation pages",
  preservedPages.map((conversation) => conversation.id).join(",") ===
    "new,1,2,3,4"
);
check(
  "first-page refresh replaces an unloaded single page",
  mergeRefreshedConversationFirstPage(
    [{ id: "1" }, { id: "2" }],
    [{ id: "new" }, { id: "1" }],
    2
  )
    .map((conversation) => conversation.id)
    .join(",") === "new,1"
);

async function finish() {
  const encodedResumeText = await new Response(
    new ReadableStream<string>({
      start(controller) {
        controller.enqueue("data: resumed\n\n");
        controller.close();
      },
    }).pipeThrough(new TextEncoderStream())
  ).text();
  check(
    "resumed string chunks are encoded for a native Response body",
    encodedResumeText === "data: resumed\n\n"
  );

  console.log(`\n${total - failures}/${total} passed`);
  if (failures > 0) process.exit(1);
}

void finish().catch((error) => {
  console.error(error);
  process.exit(1);
});
