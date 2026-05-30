# Changelog

## 0.3.28

- Reduced chat token usage by injecting only a compact personalization memory brief into each request.
- Added an on-demand `read_personal_memory` tool so the model can load full saved memory only when relevant.
- Changed answer cache invalidation to use a compact memory version signature instead of the full memory prompt.

## 0.3.27

- Replaced the memory sidebar modal with a dedicated `/memory` page matching the billing page layout pattern.
- Updated sidebar memory navigation to open the memory page directly.

## 0.3.26

- Localized the `/search` frontend through the shared UI language system.
- Added Italian and English copy for search controls, examples, result metrics, empty states, and errors.

## 0.3.25

- Added a dedicated `/search` frontend for authenticated semantic source search.
- Added sidebar navigation for direct source search alongside chat history.
- Reused shared source filters, language context, and source dialogs for search results.
- Added a polished retrieval-console UI with result metrics, topK controls, examples, loading states, and empty/error states.

## 0.3.24

- Localized and polished the billing page with plan status, usage meters, plan comparison, and upgrade calls to action.
- Added Redis-backed chat/search usage snapshots for billing visibility.
- Added a Free-plan chat banner when users approach their chat request limit.
- Made Clerk subscription detail loading best-effort and silenced the expected `billing_not_enabled` fallback.
- Switched Pro detection to prefer Clerk `auth().has({ plan })` checks.
- Moved billing usage writes to Next `after()` so they remain non-blocking.
- Stored usage snapshots from the actual Upstash rate-limit result so billing usage reflects enforced limits.
- Disabled checkout with explicit Clerk Billing enablement copy when the active Clerk instance reports billing disabled.

## 0.3.23

- Added Clerk Billing entitlement detection for Free and Pro subscription plans.
- Added plan-aware rate limits for chat and semantic search requests.
- Added `/api/billing/subscription` and a first `/billing` page with Clerk checkout/subscription actions.
- Added subscription environment variables for Clerk plan IDs, plan slugs, limits, and retrieval caps.
- Set the default Pro Clerk Billing plan key/slug to `pro_user`.
- Pinned `@clerk/nextjs` because Clerk Billing APIs are beta/experimental.

## 0.3.22

- Added streamed chat progress events so new chats can show queued, searching, tool, and drafting states while the assistant is working.
- Moved first-message conversation creation into the chat request path to avoid an extra client-side preflight request before sending.
- Added discreet waiting copy and tool activity indicators for retrieval/tool phases.
- Updated retrieval tools to report live progress details including tool name, source count, cache hit, and elapsed time.
- Made retrieval tool cache writes non-blocking so Redis writes do not delay the model after a tool finishes.
- Batched Voyage embeddings for conference talk query candidates to reduce repeated embedding calls during `search_conference_talks`.
- Updated PWA service worker handling to avoid caching `/_next/*` runtime chunks and unregister service workers in development, preventing stale module factory errors.

## 0.3.12

- Decoupled UI language selection from retrieval and answer-language routing.
- Added query language detection and translation into the configured Pinecone index language before search.
- Added a scalable UI language selector with additional interface language options and English fallback copy.
