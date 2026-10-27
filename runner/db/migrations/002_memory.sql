-- SB-08: agent memory. Profile facts go into every prompt; journal entries are found by
-- full-text search. Scoped to the signed-in owner like the records, and keyed by the
-- agent's record id. `source` marks imported items so an import can run twice safely.
-- Nothing prunes this table yet; items are capped in size, not in number.

create table memory_items (
  id bigserial primary key,
  owner text not null,
  agent_id text not null,
  kind text not null check (kind in ('profile', 'journal')),
  text text not null check (length(text) between 1 and 16384),
  source text,
  created_at timestamptz not null default now(),
  tsv tsvector generated always as (to_tsvector('english', text)) stored
);
create index memory_items_tsv on memory_items using gin (tsv);
create index memory_items_by_agent on memory_items (owner, agent_id, kind, created_at desc);
create unique index memory_items_source on memory_items (owner, agent_id, source) where source is not null;
