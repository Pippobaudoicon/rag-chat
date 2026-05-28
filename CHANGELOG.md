# Changelog

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
