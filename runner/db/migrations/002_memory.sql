-- SB-08: agent memory. Profile items go into every prompt; journal items are found by
-- full-text search. Scoped to the signed-in owner like the records, and keyed by the agent's
-- record id. Imported items carry source_hash so an import can run twice safely (NULLs, from
-- items saved by hand, never collide). Additive only. Nothing prunes this table yet; items
-- are capped in size, not in number.

create table memory_items (
  id bigserial primary key,
  owner text not null,
  agent_id text not null,
  kind text not null check (kind in ('profile', 'journal')),
  text text not null check (length(text) between 1 and 8000),
  created_at timestamptz not null default now(),
  source_hash text,
  tsv tsvector generated always as (to_tsvector('english', text)) stored
);
create unique index memory_items_source on memory_items (owner, agent_id, source_hash);
create index memory_items_by_agent on memory_items (owner, agent_id, kind, created_at desc);
create index memory_items_tsv on memory_items using gin (tsv);
