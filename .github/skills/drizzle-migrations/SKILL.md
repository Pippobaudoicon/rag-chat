---
name: drizzle-migrations
description: "Run and validate Drizzle migrations in this workspace. Use when adding/changing database tables, columns, constraints, or indexes, and when users ask migrate/db migration/drizzle migration/neon schema update."
argument-hint: "Describe the schema change and environment (local/prod)."
user-invocable: true
---

# Drizzle Migrations For This Workspace

## Outcome
Apply schema changes safely using Drizzle in this project and verify the app still builds.

## When To Use
- User asks to run or create a migration.
- Schema changed in src/lib/db/schema.ts.
- A new API feature needs persistent DB fields.

## Preconditions
1. Work from the rag-chat workspace root.
2. Ensure DATABASE_URL is available (typically from .env.local).
3. Confirm drizzle.config.ts points to:
- schema: ./src/lib/db/schema.ts
- out: ./migrations

## Procedure
1. Identify schema delta.
- Update schema definitions in src/lib/db/schema.ts.
- Keep naming consistent with existing rag_ table prefix.

2. Generate migration files.
- Run:
```bash
npx dotenv -e .env.local -- drizzle-kit generate
```
- Expected output: new SQL file in ./migrations and updated ./migrations/meta files.

3. Review generated SQL.
- Verify table names, FK actions, nullable/default behavior.
- Validate destructive operations explicitly (drop/rename) before applying.

4. Apply migration.
- Local/staging/prod command:
```bash
npx dotenv -e .env.local -- drizzle-kit migrate
```

5. Validate application health.
- Build check:
```bash
npm run build
```
- If feature-specific API was added, do one smoke request for that API.

## Decision Points
- If user asks "quick sync" and no SQL audit is needed:
  Use drizzle-kit push only for non-production experiments.
- If migration SQL was hand-written:
  Ensure migrations/meta/_journal.json entry order and tag are correct.
- If migration fails with missing env:
  Re-run with dotenv wrapper and verify DATABASE_URL.

## Completion Checks
- Migration applied without errors.
- New migration entry exists and is tracked in migrations/meta.
- App builds successfully after migration.
- Feature using the schema change can read/write expected fields.

## Safety Rules
- Do not run destructive SQL without explicit user approval.
- Prefer generate + migrate over push for auditable history.
- Never use a production DATABASE_URL unless the user explicitly requested production migration.

## References
- [Drizzle Commands](./references/drizzle-commands.md)
