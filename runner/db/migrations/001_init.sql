-- SB-02: one record per entity instead of one workspace snapshot.
-- Every row belongs to one signed-in user (owner = Firebase uid), carries the page's
-- object as `data`, and has a version. An edit names the version it read; a stale
-- version is refused (409) so two devices never overwrite each other silently.
-- Deletes are tombstones, so other devices learn about them from the change feed.
-- Tables for later items (jobs, approvals, memory, ...) arrive with those items.

create table agents (
  owner text not null,
  id text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  data jsonb not null,
  primary key (owner, id)
);

create table threads (
  owner text not null,
  id text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  data jsonb not null,
  primary key (owner, id)
);

-- Messages are their own rows (no cap per thread), ordered by the page's createdAt.
create table messages (
  owner text not null,
  id text not null,
  thread_id text not null,
  created_at bigint not null default 0,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  data jsonb not null,
  primary key (owner, id)
);
create index messages_by_thread on messages (owner, thread_id, created_at, id);

create table routines (
  owner text not null,
  id text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  data jsonb not null,
  primary key (owner, id)
);

-- Everything else the page keeps (tasks, reminders, events, contacts, logs, computer
-- events, and the settings and studio singletons), one row per item.
create table workspace_items (
  owner text not null,
  kind text not null,
  id text not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  data jsonb not null,
  primary key (owner, kind, id)
);

-- The change feed: one row per write, in commit order per owner.
create table changes (
  seq bigserial primary key,
  owner text not null,
  kind text not null,
  id text not null,
  version integer not null,
  at timestamptz not null default now()
);
create index changes_by_owner on changes (owner, seq);
