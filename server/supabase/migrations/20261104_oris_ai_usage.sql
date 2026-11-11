-- Applied to Supabase project "oris" (evmaqpautompzugovzly) on 2026-11-04.
create table public.ai_usage (
  day date not null default (now() at time zone 'utc')::date,
  kind text not null check (kind in ('install','ip','global')),
  key text not null,
  count int not null default 0,
  primary key (day, kind, key)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.oris_take(p_install text, p_ip text, p_install_limit int, p_ip_limit int, p_global_limit int)
returns text language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date; n int;
begin
  insert into ai_usage(day, kind, key, count) values (d, 'global', '*', 1)
    on conflict (day, kind, key) do update set count = ai_usage.count + 1 returning count into n;
  if n > p_global_limit then return 'global'; end if;
  insert into ai_usage(day, kind, key, count) values (d, 'ip', p_ip, 1)
    on conflict (day, kind, key) do update set count = ai_usage.count + 1 returning count into n;
  if n > p_ip_limit then return 'ip'; end if;
  insert into ai_usage(day, kind, key, count) values (d, 'install', p_install, 1)
    on conflict (day, kind, key) do update set count = ai_usage.count + 1 returning count into n;
  if n > p_install_limit then return 'install'; end if;
  return 'ok:' || (p_install_limit - n);
end; $$;
revoke execute on function public.oris_take(text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.oris_take(text, text, int, int, int) to service_role;

create or replace function public.oris_cleanup() returns void language sql security definer set search_path = public as
$$ delete from ai_usage where day < (now() at time zone 'utc')::date - 7; $$;
revoke execute on function public.oris_cleanup() from public, anon, authenticated;
grant execute on function public.oris_cleanup() to service_role;
