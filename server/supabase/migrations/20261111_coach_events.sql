-- Anonymous study events from students who switched on "Help improve Oris".
-- No names, subjects, topics or text: only event kind, day, hour, level and small numbers.
create table public.coach_events (
  id bigserial primary key,
  install_hash text not null,
  kind text not null check (kind ~ '^[a-z]+(\.[a-z]+)?$' and length(kind) <= 32),
  day date not null,
  hour smallint not null check (hour between 0 and 23),
  level text not null default '' check (level in ('', 'school', 'college', 'competitive')),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 512),
  received_at timestamptz not null default now()
);
create index coach_events_kind_day on public.coach_events (kind, day);
alter table public.coach_events enable row level security;
revoke all on public.coach_events from anon, authenticated;
grant insert, select on public.coach_events to service_role;
grant usage, select on sequence public.coach_events_id_seq to service_role;
