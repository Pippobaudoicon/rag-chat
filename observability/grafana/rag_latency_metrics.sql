-- Restricted, timing-only view over rag_messages for Grafana.
--
-- Exposes ONLY latency fields. Deliberately excludes message `content`,
-- `sources_json`, and `details_json -> retrieval -> searchQuery` (the latter is
-- the user's translated query — PII-adjacent). Grafana connects to this view
-- via a dedicated read-only role that has NO access to the base table.
--
-- Run once against the Neon database (as the table owner / a superuser-ish role).

create or replace view rag_latency_metrics as
select
  id,
  created_at,
  details_json -> 'latency' ->> 'path'                                  as path,
  details_json -> 'latency' ->> 'release'                               as release,
  details_json ->> 'model'                                              as model,
  (details_json -> 'latency' -> 'milestones' ->> 'preStreamMs')::numeric       as pre_stream_ms,
  (details_json -> 'latency' -> 'milestones' ->> 'firstModelChunkMs')::numeric as first_model_chunk_ms,
  (details_json -> 'latency' -> 'milestones' ->> 'firstToolCallMs')::numeric   as first_tool_call_ms,
  (details_json -> 'latency' -> 'milestones' ->> 'serverFirstTextMs')::numeric as server_first_text_ms,
  (details_json -> 'latency' -> 'milestones' ->> 'answerReadyMs')::numeric     as answer_ready_ms,
  -- Headline optimization target: the routing LLM call.
  (details_json -> 'latency' -> 'phases' ->> 'routing')::numeric        as routing_ms,
  -- Full phase + tool maps for ad-hoc panels (no message content in either).
  details_json -> 'latency' -> 'phases'                                 as phases,
  details_json -> 'latency' -> 'tools'                                  as tools
from rag_messages
where role = 'assistant'
  and details_json ? 'latency';

-- IMPORTANT: keep the view as the default SECURITY DEFINER (do NOT set
-- security_invoker=true) so the read-only role can read the view WITHOUT being
-- granted access to rag_messages.

-- ── Grant only (role provisioned out-of-band) ───────────────────────────────
-- This tracked script intentionally does NOT create the login role or set any
-- password. Provision `grafana_ro` out-of-band with a strong, non-committed
-- secret (Neon Console → Roles, or a one-off psql command kept out of version
-- control), then run the grants below. Keeping credentials out of tracked SQL
-- avoids shipping a known/default password in the repo.
--
--   Example (run manually, NOT committed — note the leading space to skip shell
--   history, and prefer the Neon Console which never echoes the secret):
--    psql "$DATABASE_URL" -c "create role grafana_ro login password '<strong-secret>'"
--
-- The grants are safe to keep here — they reference the role but contain no
-- secret. They no-op-error if the role is missing, which is the intended signal
-- to provision it first.
revoke all on all tables in schema public from grafana_ro;
grant usage on schema public to grafana_ro;
grant select on rag_latency_metrics to grafana_ro;