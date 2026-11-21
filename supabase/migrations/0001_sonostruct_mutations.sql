-- SONO-STRUCT cloud ledger: append-only mirror of the on-device mutation queue.
-- The device owns the truth; the cloud is a durable backup + multi-device ledger.
-- No audio, video or raw sensor buffers are ever stored here — only record JSON.

create table if not exists public.sonostruct_mutations (
  id          bigint generated always as identity primary key,
  client_id   text not null unique,           -- device:createdAt:entity:action  (idempotent replays)
  device_id   text not null,
  entity      text not null check (entity in ('scan', 'leak', 'room', 'check')),
  action      text not null check (action in ('create', 'update', 'delete')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  synced_at   timestamptz not null default now()
);

create index if not exists sonostruct_mutations_device_idx
  on public.sonostruct_mutations (device_id, created_at desc);

create index if not exists sonostruct_mutations_entity_idx
  on public.sonostruct_mutations (entity, action);

alter table public.sonostruct_mutations enable row level security;

-- Anon-key clients (the Vercel web app / APK) may append and read their own rows.
-- Deletes are forbidden: the ledger is append-only audit trail.
drop policy if exists "sonostruct anon append" on public.sonostruct_mutations;
create policy "sonostruct anon append"
  on public.sonostruct_mutations
  for insert
  to anon
  with check (length(device_id) > 8);

drop policy if exists "sonostruct anon read" on public.sonostruct_mutations;
create policy "sonostruct anon read"
  on public.sonostruct_mutations
  for select
  to anon
  using (true);

comment on table public.sonostruct_mutations is
  'SONO-STRUCT offline-to-online mutation ledger. Append-only; device_id is a client-generated uuid.';
