# ChatLDS

An AI study companion for Latter-day Saint scriptures and teachings. ChatLDS
retrieves passages and talks, streams answers with linked citations, and keeps
conversations available for continued study.

[Get support](SUPPORT.md) · [Contribute](CONTRIBUTING.md) ·
[Security](SECURITY.md) · [Donate](DONATE.md) · [Changelog](CHANGELOG.md) ·
[Apache 2.0 license](LICENSE)

[![Donate with PayPal](https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif)](https://www.paypal.com/donate/?hosted_button_id=3NFDJJ3NCY33L)

## Features

- **Chat with sources:** scripture lookups, conference talk searches, and topical
  retrieval with inline citations and source cards.
- **Choose your scope:** Standard covers scriptures, conference, handbook, study
  helps, and topics; Super searches all indexed namespaces for signed-in users.
- **Continue your study:** saved conversations, response styles, suggested next
  questions, and personalization memory.
- **Search directly:** a dedicated semantic search page for inspecting sources.
- **Use your language:** English, Italian, and Spanish interface copy; answers
  follow the question's language. Indexed scriptures are English and Italian;
  other source collections are English.
- **Access on mobile:** an installable web app, with a separate native client
  consuming the same hosted API.
- **Guest and account access:** quota-limited guest chat, Clerk authentication,
  and Free/Pro entitlements through Clerk Billing.

AI answers can contain mistakes. Check the linked original sources when studying
or sharing an answer.

## Stack

| Layer | Technology |
| --- | --- |
| Web app | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| Authentication and subscriptions | Clerk and Clerk Billing |
| Conversation storage | Neon Postgres and Drizzle ORM |
| Retrieval | Pinecone and Voyage AI embeddings |
| Answer generation | Vercel AI SDK through AI Gateway |
| Caching, quotas, stream resume | Upstash Redis |

## Run locally

Use Node.js 20.9 or newer and the pnpm version pinned in `package.json`.
You need your own service credentials and a populated Pinecone index compatible
with the [corpus contract](docs/PROJECT_INFO.md). This repository is the web app
and API; it does not provision or ingest the source corpus.

```bash
git clone https://github.com/Pippobaudoicon/rag-chat.git
cd rag-chat
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Configure `.env.local` using [.env.example](.env.example):

| Service | Configuration |
| --- | --- |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` |
| Neon | `DATABASE_URL` |
| Pinecone | `PINECONE_API_KEY`, `PINECONE_INDEX` |
| Voyage AI | `VOYAGE_API_KEY` |
| Upstash (optional) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| AI Gateway | Gateway authentication for your local/Vercel environment |

For a linked Vercel project, `vercel env pull .env.local` can supply configured
environment values. Keep that file private. See the environment section of
[PROJECT_INFO.md](docs/PROJECT_INFO.md) for the full configuration reference.

The default Pinecone index is `lds-rag-v1`, using `voyage-4-large` embeddings
with 1024 dimensions. An empty or incompatible index will not provide usable
retrieval. Upstash enables retrieval caching, rate limits, and token-level stream
resume; without it, clients fall back to polling persisted generation status.

Apply the committed migrations to your development database, then start the app:

```bash
pnpm run db:migrate
pnpm run dev
```

Open [localhost:3000/chat](http://localhost:3000/chat). Use a development database
and Clerk instance for local work.

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Start the development server |
| `pnpm run check` | Typecheck, lint, and run all unit tests |
| `pnpm run docs:guard` | Check documentation updates for core changes |
| `pnpm run build` | Create a production build |
| `pnpm run start` | Serve the production build |
| `pnpm run db:generate` | Generate a migration after schema changes |
| `pnpm run db:migrate` | Apply migrations to the configured database |
| `pnpm run eval` | Evaluate retrieval against live Pinecone and Voyage services |

Evaluations make external API calls and may incur service charges. Vercel runs
`pnpm run check && pnpm run build` before deploying. Authenticated browser/UI
verification is performed manually.

## Project map

- [`src/app/api/chat/route.ts`](src/app/api/chat/route.ts): chat generation and persistence.
- [`src/app/api/search/route.ts`](src/app/api/search/route.ts): retrieval-only API.
- [`src/lib/rag/`](src/lib/rag/): retrieval, embeddings, tools, and prompting.
- [`src/lib/db/schema.ts`](src/lib/db/schema.ts): database schema.
- [`src/components/chat/`](src/components/chat/): chat interface and source display.
- [`docs/PROJECT_INFO.md`](docs/PROJECT_INFO.md): architecture, corpus contracts,
  environment reference, and operations.
- [`docs/MOBILE.md`](docs/MOBILE.md): shared API contracts for the native client.
- [`docs/MOBILE_APP_PLAN.md`](docs/MOBILE_APP_PLAN.md): native app direction and milestones.

## Community and license

Use [SUPPORT.md](SUPPORT.md) for questions and bug reports,
[CONTRIBUTING.md](CONTRIBUTING.md) for development guidance, and
[SECURITY.md](SECURITY.md) for sensitive reports.

To help support ongoing development and service costs, see [DONATE.md](DONATE.md).

ChatLDS application code is licensed under the [Apache License 2.0](LICENSE).
This license does not grant rights to third-party source texts, datasets,
trademarks, or dependencies. Consult their respective terms before reuse.
