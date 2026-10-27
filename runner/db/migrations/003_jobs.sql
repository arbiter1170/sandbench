-- SB-03: jobs, job events and approvals, owner-scoped like 001_init.sql. Every column SB-04
-- (detached jobs) and SB-06 (approvals) need is here, so later items never alter `jobs`.
-- pg-boss keeps its own schema (SB-03 PR 2). SB-06 adds audit_log in 004_audit.sql.

create table jobs (
  id text primary key,
  owner text not null,
  agent_id text not null,
  kind text not null check (kind in ('turn', 'exec', 'build')),
  status text not null check (status in ('queued', 'running', 'done', 'failed', 'cancelled', 'interrupted')),
  parent_job_id text references jobs (id) on delete set null,
  root_job_id text,
  payload jsonb not null default '{}',
  pid integer,
  pgid integer,
  timeout_s integer not null default 3600 check (timeout_s > 0),
  heartbeat_at timestamptz,
  exit_code integer,
  error text,
  resumable boolean not null default false,
  attempt integer not null default 0,
  singleton_key text,
  session_id text,
  queue_job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_by_owner_status on jobs (owner, status);
create index jobs_by_root on jobs (root_job_id);
create index jobs_by_agent_status on jobs (agent_id, status);

create table job_events (
  job_id text not null references jobs (id) on delete cascade,
  seq integer not null check (seq > 0),
  type text not null,
  data jsonb not null default '{}',
  at timestamptz not null default now(),
  primary key (job_id, seq)
);

create table approvals (
  id text primary key,
  owner text not null,
  job_id text not null references jobs (id) on delete cascade,
  agent_id text not null,
  class text not null check (class in ('green', 'yellow', 'red')),
  required_approver text not null check (required_approver in ('owner', 'vincent')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')),
  decision_id text,
  request jsonb not null default '{}',
  decided_by text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (class <> 'red' or required_approver = 'vincent')
);
create index approvals_by_owner_status on approvals (owner, status);
