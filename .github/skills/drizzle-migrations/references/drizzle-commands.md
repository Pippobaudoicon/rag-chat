# Drizzle Commands (Workspace)

Run from rag-chat root.

## Core
```bash
npx dotenv -e .env.local -- drizzle-kit generate
npx dotenv -e .env.local -- drizzle-kit migrate
```

## Optional
```bash
npx dotenv -e .env.local -- drizzle-kit check
npx dotenv -e .env.local -- drizzle-kit studio
npx dotenv -e .env.local -- drizzle-kit push
```

## Typical Sequence
1. Edit src/lib/db/schema.ts
2. generate
3. review SQL in migrations/
4. migrate
5. npm run build

## Common Failure Modes
- DATABASE_URL missing: verify .env.local and dotenv command.
- Wrong working directory: run command from rag-chat root.
- Migration order issue: verify migrations/meta/_journal.json is monotonic.
