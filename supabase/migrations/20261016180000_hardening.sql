-- Phase 14: security and performance hardening.

-- ---------------------------------------------------------------------------
-- Table privileges: signed-in users may write a table only where a policy
-- allows that kind of write. Everything else changes through RPCs. TRUNCATE
-- (which RLS doesn't cover) is never granted.
-- ---------------------------------------------------------------------------

do $$
declare
  t record;
  v_cmd text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on public.%I from public, anon, authenticated', t.tablename);
    foreach v_cmd in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.tablename and p.cmd in (v_cmd, 'ALL')
      ) then
        execute format('revoke %s on public.%I from public, anon, authenticated', v_cmd, t.tablename);
      end if;
    end loop;
  end loop;
end;
$$;

-- New tables start with no write privileges for app users either; each
-- migration grants what its policies allow.
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- An index for every foreign key, so joins and deletes don't scan tables.
-- ---------------------------------------------------------------------------

do $$
declare
  fk record;
  v_name text;
begin
  for fk in
    select c.conrelid::regclass as tbl, rel.relname as table_name, c.conname,
           array_agg(a.attname order by k.n) as cols, c.conkey
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, n)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f' and ns.nspname = 'public'
    group by c.conrelid, rel.relname, c.conname, c.conkey
  loop
    -- Covered when some index starts with the key's columns.
    continue when exists (
      select 1 from pg_index i
      where i.indrelid = fk.tbl::oid
        and (i.indkey::int2[])[0:cardinality(fk.conkey) - 1] = fk.conkey
    );
    v_name := left(fk.table_name || '_' || array_to_string(fk.cols, '_') || '_fk_idx', 63);
    execute format('create index if not exists %I on %s (%s)', v_name, fk.tbl,
      (select string_agg(format('%I', c), ', ') from unnest(fk.cols) c));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limits for server actions that create logins and devices, and for
-- device setup codes (which can be tried without signing in).
-- ---------------------------------------------------------------------------

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security;
-- No policies: only the server (service role) uses it.
revoke all on public.rate_limits from public, anon, authenticated;
create index rate_limits_window_idx on public.rate_limits (window_start);

-- Counts one hit for a key in the current fixed window; true while the
-- key is within p_max hits per p_window_seconds. Old windows are cleared.
create function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  if p_key is null or p_max < 1 or p_window_seconds < 1 then
    raise exception 'Bad rate limit' using errcode = '22023';
  end if;
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
