# Latency dashboards (Grafana → Neon)

Quantify chat-response latency from the `latency` trace persisted on assistant
messages (`rag_messages.details_json -> 'latency'`, see `LatencyTrace` in
`src/lib/types.ts`). Grafana connects **outbound** to Neon, so nothing on the
homeserver needs to be exposed to Vercel.

## One-time setup

1. **Create the restricted view + read-only role** (run against Neon as an
   owner/admin role):

   ```bash
   psql "$DATABASE_URL" -f rag_latency_metrics.sql
   ```

   Replace `CHANGE_ME` in `rag_latency_metrics.sql` with a real password first.
   The view is SECURITY DEFINER, so `grafana_ro` can read it **without** access
   to `rag_messages` — it never sees message content or the translated query.

2. **Add the Postgres data source** in Grafana:
   - Host: your Neon host (`...neon.tech:5432`), Database: your DB name.
   - User: `grafana_ro`, Password: the one you set above.
   - TLS/SSL Mode: `require`.

3. **Import the dashboard**: Dashboards → Import → upload `dashboard.json`, and
   pick the data source created in step 2 for the `DS_POSTGRES` input.

## What's on it

- **Server first-text (generated) p50/p95/p99** — the headline metric the
  optimization work moves. Filtered to `path = 'generated'` so instant
  answer-cache returns don't skew percentiles.
- **Tool-decision + retrieval gap** (`serverFirstText − firstToolCall`) — the
  empty tool-decision model turn + retrieval cost that speculative/eager
  retrieval is meant to remove.
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
