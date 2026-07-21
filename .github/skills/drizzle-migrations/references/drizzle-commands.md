# Drizzle Commands (Workspace)

Run from rag-chat root.

## Core
```bash
pnpm exec dotenv -e .env.local -- drizzle-kit generate
pnpm exec dotenv -e .env.local -- drizzle-kit migrate
```

## Optional
```bash
pnpm exec dotenv -e .env.local -- drizzle-kit check
pnpm exec dotenv -e .env.local -- drizzle-kit studio
pnpm exec dotenv -e .env.local -- drizzle-kit push
```

## Typical Sequence
1. Edit src/lib/db/schema.ts
2. generate
3. review SQL in migrations/
4. migrate
5. pnpm run build

## Common Failure Modes
- DATABASE_URL missing: verify .env.local and dotenv command.
- Wrong working directory: run command from rag-chat root.
- Migration order issue: verify migrations/meta/_journal.json is monotonic.
