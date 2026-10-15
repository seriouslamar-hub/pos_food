-- Phase 4: the menu.
-- One master menu (admins, menu.edit) with per-branch prices and availability.
-- Tills read it through get_menu(); availability changes reach them through
-- Realtime.

-- ---------------------------------------------------------------------------
-- Audit: composite keys for join tables, and no entries for pure re-ordering.
-- ---------------------------------------------------------------------------

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ignored constant text[] := array['pin_hash', 'updated_at', 'last_seen_at', 'sort_order'];
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_branch_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old) - v_ignored;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new) - v_ignored;
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  v_row := coalesce(v_after, v_before);
  v_branch_id := case
    when tg_table_name = 'branches' then (v_row ->> 'id')::uuid
    else (v_row ->> 'branch_id')::uuid
  end;

  perform public.write_audit(
    p_action => tg_table_name || '.' || lower(tg_op),
    p_entity => tg_table_name,
    -- Join tables have composite keys, e.g. "cashier:order.create" or
    -- "<branch>:<menu item>".
    p_entity_id => coalesce(
      v_row ->> 'id',
      nullif(concat_ws(':',
        v_row ->> 'role', v_row ->> 'permission', v_row ->> 'branch_id',
        v_row ->> 'menu_item_id', v_row ->> 'modifier_group_id',
        v_row ->> 'modifier_id', v_row ->> 'slot_id'), '')
    ),
    p_before => v_before,
    p_after => v_after,
    p_branch_id => v_branch_id
  );

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.kds_stations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index kds_stations_name_unique on public.kds_stations (lower(name));

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  colour text check (colour ~ '^#[0-9a-fA-F]{6}$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.menu_item_type as enum ('item', 'combo');

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id),
  type public.menu_item_type not null default 'item',
  name text not null check (length(btrim(name)) > 0),
  -- Shorter name for receipts and kitchen tickets; falls back to name.
  short_name text check (short_name is null or length(btrim(short_name)) > 0),
  description text,
  image_url text,
  base_price integer not null check (base_price between 0 and 100000000),
  tax_category text not null default 'standard' check (tax_category ~ '^[a-z0-9_]+$'),
  kds_station_id uuid references public.kds_stations (id),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index menu_items_category_idx on public.menu_items (category_id, sort_order);
create index menu_items_kds_station_idx on public.menu_items (kds_station_id);

create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint modifier_groups_min_le_max check (min_select <= max_select)
);

create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  -- Added to the item's price (minor units). Negative for "no cheese"-style savings.
  price_delta integer not null default 0 check (price_delta between -100000000 and 100000000),
  -- Overrides the item's station, e.g. a side added to a burger.
  kds_station_id uuid references public.kds_stations (id),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index modifiers_group_idx on public.modifiers (group_id, sort_order);
create index modifiers_kds_station_idx on public.modifiers (kds_station_id);

create table public.item_modifier_groups (
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  modifier_group_id uuid not null references public.modifier_groups (id) on delete cascade,
  sort_order integer not null default 0,
  primary key (menu_item_id, modifier_group_id)
);
create index item_modifier_groups_group_idx on public.item_modifier_groups (modifier_group_id);

-- A combo (menu item of type 'combo') is made of slots, e.g. "Side" and
-- "Drink"; each slot offers plain items, optionally for an upcharge.
create table public.combo_slots (
  id uuid primary key default gen_random_uuid(),
  combo_item_id uuid not null references public.menu_items (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index combo_slots_combo_idx on public.combo_slots (combo_item_id, sort_order);

create table public.combo_slot_options (
  slot_id uuid not null references public.combo_slots (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id),
  upcharge integer not null default 0 check (upcharge between 0 and 100000000),
  is_default boolean not null default false,
  sort_order integer not null default 0,
  primary key (slot_id, menu_item_id)
);
create unique index combo_slot_options_one_default on public.combo_slot_options (slot_id) where is_default;
create index combo_slot_options_item_idx on public.combo_slot_options (menu_item_id);

-- Per-branch price and availability. No row means the base price, available.
create table public.branch_menu_items (
  branch_id uuid not null references public.branches (id),
  menu_item_id uuid not null references public.menu_items (id) on delete cascade,
  price_override integer check (price_override is null or price_override between 0 and 100000000),
  is_available boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (branch_id, menu_item_id)
);
create index branch_menu_items_item_idx on public.branch_menu_items (menu_item_id);

create table public.branch_modifiers (
  branch_id uuid not null references public.branches (id),
  modifier_id uuid not null references public.modifiers (id) on delete cascade,
  is_available boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (branch_id, modifier_id)
);
create index branch_modifiers_modifier_idx on public.branch_modifiers (modifier_id);

-- ---------------------------------------------------------------------------
-- Guards: combos contain plain items only
-- ---------------------------------------------------------------------------

create function public.menu_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> old.type then
    if old.type = 'combo' and exists (select 1 from public.combo_slots where combo_item_id = old.id) then
      raise exception 'Remove the combo''s slots before turning it into a plain item'
        using errcode = '22023';
    end if;
    if old.type = 'item' and exists (select 1 from public.combo_slot_options where menu_item_id = old.id) then
      raise exception 'This item is part of a combo, so it can''t become a combo itself'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger menu_items_guard
  before update of type on public.menu_items
  for each row execute function public.menu_items_guard();

create function public.combo_slots_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.menu_items where id = new.combo_item_id and type = 'combo') then
    raise exception 'Slots can only be added to combos'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger combo_slots_guard
  before insert or update of combo_item_id on public.combo_slots
  for each row execute function public.combo_slots_guard();

create function public.combo_slot_options_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.menu_items where id = new.menu_item_id and type = 'combo') then
    raise exception 'A combo can''t contain another combo'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger combo_slot_options_guard
  before insert or update of menu_item_id on public.combo_slot_options
  for each row execute function public.combo_slot_options_guard();

-- ---------------------------------------------------------------------------
-- updated_at and audit triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['kds_stations', 'categories', 'menu_items', 'modifier_groups', 'modifiers',
                           'combo_slots', 'branch_menu_items', 'branch_modifiers']
  loop
    execute format(
      'create trigger %1$s_set_updated_at before update on public.%1$s
         for each row execute function public.set_updated_at()', t);
  end loop;

  foreach t in array array['kds_stations', 'categories', 'menu_items', 'modifier_groups', 'modifiers',
                           'item_modifier_groups', 'combo_slots', 'combo_slot_options',
                           'branch_menu_items', 'branch_modifiers']
  loop
    execute format(
      'create trigger %1$s_audit after insert or update or delete on public.%1$s
         for each row execute function public.audit_row_change()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: everyone signed in to the back office or a device reads the menu;
-- menu.edit changes it; branch prices and availability go through RPCs.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['kds_stations', 'categories', 'menu_items', 'modifier_groups', 'modifiers',
                           'item_modifier_groups', 'combo_slots', 'combo_slot_options']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using ((select public.is_admin()) or (select public.is_manager()) or (select public.is_device()))', t);
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated
         with check ((select public.has_permission(''menu.edit'')))', t);
    execute format(
      'create policy %1$s_update on public.%1$s for update to authenticated
         using ((select public.has_permission(''menu.edit'')))
         with check ((select public.has_permission(''menu.edit'')))', t);
  end loop;

  -- Links and combo structure can be removed; everything else is deactivated.
  foreach t in array array['item_modifier_groups', 'combo_slots', 'combo_slot_options']
  loop
    execute format('grant delete on public.%I to authenticated', t);
    execute format(
      'create policy %1$s_delete on public.%1$s for delete to authenticated
         using ((select public.has_permission(''menu.edit'')))', t);
  end loop;

  foreach t in array array['branch_menu_items', 'branch_modifiers']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated
         using (
           (select public.is_admin())
           or (
             branch_id = (select public.current_branch_id())
             and ((select public.is_manager()) or (select public.is_device()))
           )
         )', t);
  end loop;
end;
$$;

-- Tills hear about availability and menu changes as they happen.
alter publication supabase_realtime add table
  public.branch_menu_items,
  public.branch_modifiers,
  public.menu_items,
  public.modifiers;

-- ---------------------------------------------------------------------------
-- Menu images: public, written by staff with menu.edit
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy menu_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and (select public.has_permission('menu.edit')));

create policy menu_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and (select public.has_permission('menu.edit')))
  with check (bucket_id = 'menu-images' and (select public.has_permission('menu.edit')));

create policy menu_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and (select public.has_permission('menu.edit')));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Marks an item or modifier in or out of stock for one branch.
create function public.set_availability(
  p_branch_id uuid,
  p_kind text,
  p_target_id uuid,
  p_available boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if public.current_staff_id() is null
    or not public.has_permission('menu.availability')
    or not public.can_access_branch(p_branch_id) then
    raise exception 'You are not allowed to change availability for this branch'
      using errcode = '42501';
  end if;
  if p_available is null then
    raise exception 'Say whether it is available'
      using errcode = '22023';
  end if;

  if p_kind = 'item' then
    if not exists (select 1 from public.menu_items where id = p_target_id) then
      raise exception 'Menu item not found' using errcode = 'P0002';
    end if;
    insert into public.branch_menu_items (branch_id, menu_item_id, is_available)
    values (p_branch_id, p_target_id, p_available)
    on conflict (branch_id, menu_item_id) do update
      set is_available = excluded.is_available
      where public.branch_menu_items.is_available is distinct from excluded.is_available;
  elsif p_kind = 'modifier' then
    if not exists (select 1 from public.modifiers where id = p_target_id) then
      raise exception 'Modifier not found' using errcode = 'P0002';
    end if;
    insert into public.branch_modifiers (branch_id, modifier_id, is_available)
    values (p_branch_id, p_target_id, p_available)
    on conflict (branch_id, modifier_id) do update
      set is_available = excluded.is_available
      where public.branch_modifiers.is_available is distinct from excluded.is_available;
  else
    raise exception 'Unknown kind "%"', p_kind using errcode = '22023';
  end if;
end;
$$;

-- Sets (or, with null, removes) a branch's price for an item.
create function public.set_branch_price(p_branch_id uuid, p_menu_item_id uuid, p_price integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('menu.edit') or not public.can_access_branch(p_branch_id) then
    raise exception 'You are not allowed to change prices'
      using errcode = '42501';
  end if;
  if p_price is not null and (p_price < 0 or p_price > 100000000) then
    raise exception 'Enter a price of zero or more'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.menu_items where id = p_menu_item_id) then
    raise exception 'Menu item not found' using errcode = 'P0002';
  end if;

  insert into public.branch_menu_items (branch_id, menu_item_id, price_override)
  values (p_branch_id, p_menu_item_id, p_price)
  on conflict (branch_id, menu_item_id) do update
    set price_override = excluded.price_override
    where public.branch_menu_items.price_override is distinct from excluded.price_override;
end;
$$;

-- Saves a new order for one list (drag-and-drop). For item_modifier_groups
-- and combo_slot_options, p_parent_id is the item or slot.
create function public.reorder_menu(p_kind text, p_ids uuid[], p_parent_id uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('menu.edit') then
    raise exception 'You are not allowed to change the menu'
      using errcode = '42501';
  end if;

  case p_kind
    when 'categories' then
      update public.categories t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n) where t.id = o.id;
    when 'menu_items' then
      update public.menu_items t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n) where t.id = o.id;
    when 'modifier_groups' then
      update public.modifier_groups t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n) where t.id = o.id;
    when 'modifiers' then
      update public.modifiers t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n) where t.id = o.id;
    when 'kds_stations' then
      update public.kds_stations t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n) where t.id = o.id;
    when 'combo_slots' then
      update public.combo_slots t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n) where t.id = o.id;
    when 'item_modifier_groups' then
      update public.item_modifier_groups t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n)
      where t.menu_item_id = p_parent_id and t.modifier_group_id = o.id;
    when 'combo_slot_options' then
      update public.combo_slot_options t set sort_order = o.n * 10
      from unnest(p_ids) with ordinality as o(id, n)
      where t.slot_id = p_parent_id and t.menu_item_id = o.id;
    else
      raise exception 'Unknown list "%"', p_kind using errcode = '22023';
  end case;
end;
$$;

-- The whole menu for one branch, with effective prices and availability, as
-- one JSON document the till caches. Inactive things are left out; combo
-- options refer to items in the "items" list.
create function public.get_menu(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches;
  v_menu jsonb;
begin
  if not public.can_access_branch(p_branch_id) then
    raise exception 'You can''t see this branch''s menu'
      using errcode = '42501';
  end if;
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  with
  items as (
    select mi.*,
      coalesce(bmi.price_override, mi.base_price) as price,
      coalesce(bmi.is_available, true) as available
    from public.menu_items mi
    left join public.branch_menu_items bmi
      on bmi.menu_item_id = mi.id and bmi.branch_id = p_branch_id
    where mi.is_active
  ),
  mods as (
    select m.*, coalesce(bm.is_available, true) as available
    from public.modifiers m
    left join public.branch_modifiers bm
      on bm.modifier_id = m.id and bm.branch_id = p_branch_id
    where m.is_active
  ),
  groups as (
    select g.id, jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'min_select', g.min_select,
      'max_select', g.max_select,
      'modifiers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'price_delta', m.price_delta,
          'kds_station_id', m.kds_station_id,
          'is_available', m.available
        ) order by m.sort_order, m.name)
        from mods m where m.group_id = g.id
      ), '[]'::jsonb)
    ) as doc
    from public.modifier_groups g
    where g.is_active
  )
  select jsonb_build_object(
    'branch_id', v_branch.id,
    'branch_name', v_branch.name,
    'currency_code', v_branch.currency_code,
    'timezone', v_branch.timezone,
    'generated_at', now(),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'colour', c.colour)
        order by c.sort_order, c.name)
      from public.categories c where c.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'category_id', i.category_id,
        'type', i.type,
        'name', i.name,
        'short_name', coalesce(i.short_name, i.name),
        'description', i.description,
        'image_url', i.image_url,
        'price', i.price,
        'base_price', i.base_price,
        'tax_category', i.tax_category,
        'kds_station_id', i.kds_station_id,
        'is_available', i.available,
        'modifier_groups', coalesce((
          select jsonb_agg(g.doc order by img.sort_order)
          from public.item_modifier_groups img
          join groups g on g.id = img.modifier_group_id
          where img.menu_item_id = i.id
        ), '[]'::jsonb),
        'combo_slots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'required', s.required,
            'options', coalesce((
              select jsonb_agg(jsonb_build_object(
                'menu_item_id', o.menu_item_id,
                'upcharge', o.upcharge,
                'is_default', o.is_default
              ) order by o.sort_order)
              from public.combo_slot_options o
              join items oi on oi.id = o.menu_item_id
              where o.slot_id = s.id
            ), '[]'::jsonb)
          ) order by s.sort_order, s.name)
          from public.combo_slots s
          where s.combo_item_id = i.id
        ), '[]'::jsonb)
      ) order by i.sort_order, i.name)
      from items i
    ), '[]'::jsonb),
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'rate_bps', t.rate_bps,
        'is_inclusive', t.is_inclusive,
        'tax_category', t.tax_category
      ) order by t.sort_order, t.name)
      from public.taxes t where t.is_active
    ), '[]'::jsonb),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.sort_order, k.name)
      from public.kds_stations k where k.is_active
    ), '[]'::jsonb)
  ) into v_menu;

  return v_menu;
end;
$$;

-- A sample fast-food menu to try the system with. Only for an empty menu.
create function public.load_sample_menu()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  st_fryer uuid; st_grill uuid; st_sides uuid; st_drinks uuid; st_assembly uuid;
  c_chicken uuid; c_burgers uuid; c_wraps uuid; c_sides uuid; c_drinks uuid; c_meals uuid;
  g_flavour uuid; g_extras uuid; g_fries_size uuid; g_drink_size uuid;
  i_2pc uuid; i_3pc uuid; i_8pc uuid; i_wings uuid; i_chicken_burger uuid; i_cheeseburger uuid;
  i_chicken_wrap uuid; i_veggie_wrap uuid; i_fries uuid; i_coleslaw uuid; i_rice uuid;
  i_coke uuid; i_fanta uuid; i_sprite uuid; i_water uuid; i_coke_15 uuid;
  i_meal uuid; i_bucket uuid;
  s_id uuid;
begin
  if not public.has_permission('menu.edit') then
    raise exception 'You are not allowed to change the menu' using errcode = '42501';
  end if;
  if exists (select 1 from public.menu_items) then
    raise exception 'The menu already has items. The sample menu can only be added to an empty menu.'
      using errcode = '22023';
  end if;

  -- Kitchen stations (reuse any that already exist).
  insert into public.kds_stations (name, sort_order) values ('Fryer', 10)
    on conflict ((lower(name))) do update set name = excluded.name returning id into st_fryer;
  insert into public.kds_stations (name, sort_order) values ('Grill', 20)
    on conflict ((lower(name))) do update set name = excluded.name returning id into st_grill;
  insert into public.kds_stations (name, sort_order) values ('Sides', 30)
    on conflict ((lower(name))) do update set name = excluded.name returning id into st_sides;
  insert into public.kds_stations (name, sort_order) values ('Drinks', 40)
    on conflict ((lower(name))) do update set name = excluded.name returning id into st_drinks;
  insert into public.kds_stations (name, sort_order) values ('Assembly', 50)
    on conflict ((lower(name))) do update set name = excluded.name returning id into st_assembly;

  insert into public.categories (name, colour, sort_order) values ('Meals', '#9333EA', 10) returning id into c_meals;
  insert into public.categories (name, colour, sort_order) values ('Chicken', '#EA580C', 20) returning id into c_chicken;
  insert into public.categories (name, colour, sort_order) values ('Burgers', '#DC2626', 30) returning id into c_burgers;
  insert into public.categories (name, colour, sort_order) values ('Wraps', '#CA8A04', 40) returning id into c_wraps;
  insert into public.categories (name, colour, sort_order) values ('Sides', '#16A34A', 50) returning id into c_sides;
  insert into public.categories (name, colour, sort_order) values ('Drinks', '#2563EB', 60) returning id into c_drinks;

  insert into public.modifier_groups (name, min_select, max_select, sort_order) values ('Flavour', 1, 1, 10) returning id into g_flavour;
  insert into public.modifiers (group_id, name, price_delta, sort_order) values
    (g_flavour, 'Original', 0, 10), (g_flavour, 'Spicy', 0, 20);
  insert into public.modifier_groups (name, min_select, max_select, sort_order) values ('Extras', 0, 3, 20) returning id into g_extras;
  insert into public.modifiers (group_id, name, price_delta, sort_order) values
    (g_extras, 'Extra cheese', 300, 10), (g_extras, 'Bacon', 500, 20), (g_extras, 'No onions', 0, 30);
  insert into public.modifier_groups (name, min_select, max_select, sort_order) values ('Fries size', 1, 1, 30) returning id into g_fries_size;
  insert into public.modifiers (group_id, name, price_delta, sort_order) values
    (g_fries_size, 'Regular', 0, 10), (g_fries_size, 'Large', 500, 20);
  insert into public.modifier_groups (name, min_select, max_select, sort_order) values ('Drink size', 1, 1, 40) returning id into g_drink_size;
  insert into public.modifiers (group_id, name, price_delta, sort_order) values
    (g_drink_size, 'Regular', 0, 10), (g_drink_size, 'Large', 300, 20);

  insert into public.menu_items (category_id, name, short_name, base_price, kds_station_id, sort_order)
    values (c_chicken, '2-piece chicken', '2pc chicken', 4500, st_fryer, 10) returning id into i_2pc;
  insert into public.menu_items (category_id, name, short_name, base_price, kds_station_id, sort_order)
    values (c_chicken, '3-piece chicken', '3pc chicken', 6000, st_fryer, 20) returning id into i_3pc;
  insert into public.menu_items (category_id, name, short_name, base_price, kds_station_id, sort_order)
    values (c_chicken, '8-piece chicken', '8pc chicken', 14000, st_fryer, 30) returning id into i_8pc;
  insert into public.menu_items (category_id, name, short_name, base_price, kds_station_id, sort_order)
    values (c_chicken, 'Chicken wings (6)', 'Wings x6', 4000, st_fryer, 40) returning id into i_wings;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_burgers, 'Chicken burger', 4000, st_grill, 10) returning id into i_chicken_burger;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_burgers, 'Cheeseburger', 4500, st_grill, 20) returning id into i_cheeseburger;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_wraps, 'Chicken wrap', 3500, st_assembly, 10) returning id into i_chicken_wrap;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_wraps, 'Veggie wrap', 3000, st_assembly, 20) returning id into i_veggie_wrap;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_sides, 'Fries', 1500, st_fryer, 10) returning id into i_fries;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_sides, 'Coleslaw', 1000, st_sides, 20) returning id into i_coleslaw;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_sides, 'Rice', 1200, st_sides, 30) returning id into i_rice;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_drinks, 'Coke', 1000, st_drinks, 10) returning id into i_coke;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_drinks, 'Fanta', 1000, st_drinks, 20) returning id into i_fanta;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_drinks, 'Sprite', 1000, st_drinks, 30) returning id into i_sprite;
  insert into public.menu_items (category_id, name, base_price, kds_station_id, sort_order)
    values (c_drinks, 'Water', 500, st_drinks, 40) returning id into i_water;
  insert into public.menu_items (category_id, name, short_name, base_price, kds_station_id, sort_order)
    values (c_drinks, 'Coke 1.5 L', 'Coke 1.5L', 2000, st_drinks, 50) returning id into i_coke_15;

  insert into public.item_modifier_groups (menu_item_id, modifier_group_id, sort_order) values
    (i_2pc, g_flavour, 10), (i_3pc, g_flavour, 10), (i_8pc, g_flavour, 10), (i_wings, g_flavour, 10),
    (i_chicken_wrap, g_flavour, 10),
    (i_chicken_burger, g_extras, 10), (i_cheeseburger, g_extras, 10),
    (i_fries, g_fries_size, 10),
    (i_coke, g_drink_size, 10), (i_fanta, g_drink_size, 10), (i_sprite, g_drink_size, 10);

  -- 2-piece meal: chicken + a side + a drink; upsize through the side's and
  -- drink's size modifiers.
  insert into public.menu_items (category_id, type, name, short_name, description, base_price, sort_order)
    values (c_meals, 'combo', '2-piece meal', '2pc meal', '2-piece chicken with a side and a drink', 6000, 10)
    returning id into i_meal;
  insert into public.combo_slots (combo_item_id, name, required, sort_order) values (i_meal, 'Chicken', true, 10)
    returning id into s_id;
  insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default, sort_order) values
    (s_id, i_2pc, 0, true, 10);
  insert into public.combo_slots (combo_item_id, name, required, sort_order) values (i_meal, 'Side', true, 20)
    returning id into s_id;
  insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default, sort_order) values
    (s_id, i_fries, 0, true, 10), (s_id, i_coleslaw, 0, false, 20), (s_id, i_rice, 0, false, 30);
  insert into public.combo_slots (combo_item_id, name, required, sort_order) values (i_meal, 'Drink', true, 30)
    returning id into s_id;
  insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default, sort_order) values
    (s_id, i_coke, 0, true, 10), (s_id, i_fanta, 0, false, 20), (s_id, i_sprite, 0, false, 30), (s_id, i_water, 0, false, 40);

  -- Family bucket: 8 pieces, two sides and a big drink.
  insert into public.menu_items (category_id, type, name, short_name, description, base_price, sort_order)
    values (c_meals, 'combo', 'Family bucket', 'Bucket', '8 pieces of chicken, two sides and a 1.5 L drink', 18000, 20)
    returning id into i_bucket;
  insert into public.combo_slots (combo_item_id, name, required, sort_order) values (i_bucket, 'Chicken', true, 10)
    returning id into s_id;
  insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default, sort_order) values
    (s_id, i_8pc, 0, true, 10);
  insert into public.combo_slots (combo_item_id, name, required, sort_order) values (i_bucket, 'First side', true, 20)
    returning id into s_id;
  insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default, sort_order) values
    (s_id, i_fries, 0, true, 10), (s_id, i_coleslaw, 0, false, 20), (s_id, i_rice, 0, false, 30);
  insert into public.combo_slots (combo_item_id, name, required, sort_order) values (i_bucket, 'Second side', true, 30)
    returning id into s_id;
  insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default, sort_order) values
    (s_id, i_coleslaw, 0, true, 10), (s_id, i_fries, 0, false, 20), (s_id, i_rice, 0, false, 30);
  insert into public.combo_slots (combo_item_id, name, required, sort_order) values (i_bucket, 'Drink', true, 40)
    returning id into s_id;
  insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default, sort_order) values
    (s_id, i_coke_15, 0, true, 10);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.menu_items_guard(),
  public.combo_slots_guard(),
  public.combo_slot_options_guard(),
  public.set_availability(uuid, text, uuid, boolean),
  public.set_branch_price(uuid, uuid, integer),
  public.reorder_menu(text, uuid[], uuid),
  public.get_menu(uuid),
  public.load_sample_menu()
from public, anon, authenticated;

grant execute on function
  public.set_availability(uuid, text, uuid, boolean),
  public.set_branch_price(uuid, uuid, integer),
  public.reorder_menu(text, uuid[], uuid),
  public.get_menu(uuid),
  public.load_sample_menu()
to authenticated;
