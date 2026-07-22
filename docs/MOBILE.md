# ChatLDS Mobile — Backend Sync Contract

The native app (`../chatlds-mobile`, Expo / React Native) is a **thin client over
THIS API**. The backend stays unchanged for the happy path. When you change any
of the surfaces below, update the mobile app **in the same change** and add a
`CHANGELOG.md` entry.

Why Expo, architecture, and the roadmap: `docs/MOBILE_APP_PLAN.md` and
`../chatlds-mobile/ROADMAP.md`.

## What the app consumes

- **Auth** — Clerk **bearer** (`Authorization: Bearer <session token>`), verified
  by `src/proxy.ts`. Unauthenticated API requests `307 → /sign-in`; a valid
  bearer passes straight through. Keep bearer auth working.
- **POST `/api/conversations`** — create; app reads `id` + `initialMessageId`.
- **POST `/api/chat`** — **AI SDK v6 UI Message Stream** (SSE); app parses with
  `useChat`. Don't change the stream protocol without bumping the mobile client's
  `ai` / `@ai-sdk/react` pins to match.
- **GET `/api/conversations`**, **GET `/api/conversations/[id]`** — list / history (M2).
- **GET `/api/chat/[id]/stream`** — resume in-flight answer (M2).
- On the M2 radar: `/api/feedback`, `/api/memory`, `/api/settings`, `/api/search`.

## Copied types

`chatlds-mobile/src/lib/types.ts` is a hand-copied subset of `src/lib/types.ts` +
`src/lib/api/validation.ts` (`SourceType`, `UiLanguage`, `DEFAULT_SOURCES`, the
create-conversation response). **If you change those shapes, update the copy.**

## Don'ts

- Don't require CORS for native — native `fetch` has no CORS. But keep the current
  LAN dev IP in `next.config` `allowedDevOrigins` so phone testing works.
- Don't surface the web Stripe/Clerk checkout inside a store build (App/Play IAP
  rules — see `docs/MOBILE_APP_PLAN.md` billing).
