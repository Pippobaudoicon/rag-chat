# Latency dashboards (Grafana → Neon)

Quantify chat-response latency from the `latency` trace persisted on assistant
messages (`rag_messages.details_json -> 'latency'`, see `LatencyTrace` in
`src/lib/types.ts`). Grafana connects **outbound** to Neon, so nothing on the
homeserver needs to be exposed to Vercel.

## One-time setup

1. **Provision the read-only role out-of-band** (no secret in the repo, and
   never on a command line). **Preferred: Neon Console → Roles** — create
   `grafana_ro` with a generated password; Neon never exposes it in shell history
   or process arguments.

   If you must use `psql`, do it **interactively** and disable psql history first
   so the password is neither persisted nor passed as a process argument (avoid
   `psql -c "...password..."`, which leaks via `ps`):

   ```text
   psql "$DATABASE_URL"
   -- then, inside the psql prompt:
   \set HISTFILE /dev/null
   create role grafana_ro login password '<strong-secret>';
   ```

2. **Create the view + grants** (run against Neon as an owner/admin role). This
   tracked script contains no credentials — only the view and the grants:

   ```bash
   psql "$DATABASE_URL" -f rag_latency_metrics.sql
   ```

   The view is SECURITY DEFINER, so `grafana_ro` can read it **without** access
   to `rag_messages` — it never sees message content or the translated query.

3. **Add the Postgres data source** in Grafana:
   - Host: your Neon host (`...neon.tech:5432`), Database: your DB name.
   - User: `grafana_ro`, Password: the one you set in step 1.
   - TLS/SSL Mode: `require`.

4. **Import the dashboard**: Dashboards → Import → upload `dashboard.json`, and
   pick the data source for the `DS_POSTGRES` input.

## What's on it

- **Server first-text (generated) p50/p95/p99** — the headline metric the
  optimization work moves. Filtered to `path = 'generated'` so instant
  answer-cache returns don't skew percentiles.
- **Tool-decision turn & retrieval→first-text** — `decision = firstToolCall −
  preStream` is the empty tool-decision model turn (the speculative/eager-
  retrieval target); `toolcall_to_text = serverFirstText − firstToolCall` is
  retrieval plus any later model/verifier work (not the decision itself).
- **Pre-stream phases (avg)** — routing-LLM cost vs total pre-stream time.
- **Turn volume by path** — generated / answer-cache / regenerate.
- **Per-tool latency** — wall time, success, and cache-hits per tool.

A **Releases** annotation marks the first-seen time of each `release`
(`VERCEL_GIT_COMMIT_SHA`), so before/after for a deploy reads directly off the
charts.

## Caveats

- Metrics come from **completed responses only** — aborted/rejected/errored
  requests are absent, so these percentiles are an optimization baseline, not an
  operational request SLO.
- `server_first_text_ms` is the server's first emitted text **after**
  `smoothStream` (route.ts), not browser first paint.
- If Neon doesn't have TimescaleDB, the dashboard already uses Grafana's
  `$__timeGroupAlias` macro (plain `date_trunc` under the hood) — no Timescale
  dependency.
