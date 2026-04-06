<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project Memory For Agents

Read `docs/PROJECT_INFO.md` before exploring the codebase.
It is the project knowledge base (architecture, data flow, APIs, integrations,
env requirements, constraints, and operational commands).

## Update Rule

If you change core architecture, APIs, integrations, environment requirements,
or major user flows, update `docs/PROJECT_INFO.md` in the same change.

Core tooling files:

- `package.json`
- `src/app/api/chat/route.ts`
- `src/app/api/search/route.ts`
- `src/lib/types.ts`
- `src/lib/rag/retriever.ts`
- `src/lib/rag/embedder.ts`
- `src/lib/rag/cache.ts`
- `src/lib/rag/system-prompt.ts`

Validation command:

```bash
npm run docs:guard
```
