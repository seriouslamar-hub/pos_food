-- Phase 11: inventory.
--
-- Ingredients are stocked per branch. Recipes say what a menu item, or a
-- modifier (e.g. Large fries: more potato), uses. When an order is paid its
-- recipes come out of stock ('sale' movements). Deliveries (against purchase
-- orders), waste, counts, transfers and refunds put back on the shelf move
-- stock too. Every change is a row in stock_movements; branch_stock keeps
-- the running total. Costs are integer minor units per ingredient unit.

create type public.stock_unit as enum ('pc', 'g', 'kg', 'ml', 'l', 'pack');
create type public.stock_movement_type as enum (
  'sale', 'receive', 'waste', 'count_adjust', 'transfer_in', 'transfer_out', 'refund_return'
);
create type public.purchase_order_status as enum ('draft', 'sent', 'received', 'cancelled');
create type public.stock_count_status as enum ('pending', 'approved', 'rejected');

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  phone text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_name_unique on public.suppliers (lower(name));

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  unit public.stock_unit not null,
  -- For counting by category, e.g. "Produce".
  category text,
  -- Minor units per unit (e.g. per kg).
  cost_per_unit integer not null default 0 check (cost_per_unit >= 0),
  reorder_level numeric(14, 3) not null default 0 check (reorder_level >= 0),
  supplier_id uuid references public.suppliers (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ingredients_name_unique on public.ingredients (lower(name));
create index ingredients_supplier_idx on public.ingredients (supplier_id);

-- What one of a menu item, or one choice of a modifier, uses.
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid references public.menu_items (id) on delete cascade,
  modifier_id uuid references public.modifiers (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint recipes_one_owner check (num_nonnulls(menu_item_id, modifier_id) = 1)
);
create unique index recipes_item_ingredient on public.recipes (menu_item_id, ingredient_id) where menu_item_id is not null;
create unique index recipes_modifier_ingredient on public.recipes (modifier_id, ingredient_id) where modifier_id is not null;
create index recipes_ingredient_idx on public.recipes (ingredient_id);

create table public.branch_stock (
  branch_id uuid not null references public.branches (id),
  ingredient_id uuid not null references public.ingredients (id),
  quantity_on_hand numeric(14, 3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, ingredient_id)
);
create index branch_stock_ingredient_idx on public.branch_stock (ingredient_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  ingredient_id uuid not null references public.ingredients (id),
  type public.stock_movement_type not null,
  -- Signed: negative takes stock away.
  quantity numeric(14, 3) not null check (quantity <> 0),
  -- The ingredient's cost when it moved (minor units per unit).
  unit_cost integer not null default 0,
  reference_type text,
  reference_id uuid,
  reason text,
  staff_id uuid references public.staff (id),
  created_at timestamptz not null default now()
);
create index stock_movements_branch_created_idx on public.stock_movements (branch_id, created_at desc);
create index stock_movements_reference_idx on public.stock_movements (reference_type, reference_id);
create index stock_movements_ingredient_idx on public.stock_movements (ingredient_id);
create index stock_movements_staff_idx on public.stock_movements (staff_id);

create table public.purchase_orders (
  -- Made by the browser, so saving again never makes a second order.
  id uuid primary key,
  branch_id uuid not null references public.branches (id),
  supplier_id uuid not null references public.suppliers (id),
  status public.purchase_order_status not null default 'draft',
  expected_on date,
  notes text,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  received_at timestamptz,
  received_by uuid references public.staff (id),
  updated_at timestamptz not null default now()
);
create index purchase_orders_branch_idx on public.purchase_orders (branch_id, created_at desc);
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id);

create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost integer not null default 0 check (unit_cost >= 0),
  received_quantity numeric(14, 3) check (received_quantity >= 0),
  received_unit_cost integer check (received_unit_cost >= 0),
  constraint purchase_order_lines_unique unique (purchase_order_id, ingredient_id)
);
create index purchase_order_lines_ingredient_idx on public.purchase_order_lines (ingredient_id);

create table public.stock_counts (
  id uuid primary key,
  branch_id uuid not null references public.branches (id),
  -- null: everything; otherwise one ingredient category.
  category text,
  status public.stock_count_status not null default 'pending',
  counted_by uuid references public.staff (id),
  counted_at timestamptz not null default now(),
  reviewed_by uuid references public.staff (id),
  reviewed_at timestamptz,
  review_note text
);
create index stock_counts_branch_idx on public.stock_counts (branch_id, counted_at desc);

create table public.stock_count_lines (
  stock_count_id uuid not null references public.stock_counts (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  expected numeric(14, 3) not null,
  counted numeric(14, 3) not null check (counted >= 0),
  variance numeric(14, 3) generated always as (counted - expected) stored,
  primary key (stock_count_id, ingredient_id)
);
create index stock_count_lines_ingredient_idx on public.stock_count_lines (ingredient_id);

alter table public.orders add column stock_deducted_at timestamptz;
alter table public.refunds add column returned_to_stock boolean not null default false;

-- Setup tables: admins edit them; managers read them. Changes are audited.
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
create trigger ingredients_set_updated_at before update on public.ingredients
  for each row execute function public.set_updated_at();
create trigger purchase_orders_set_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();
create trigger suppliers_audit after insert or update or delete on public.suppliers
  for each row execute function public.audit_row_change();
create trigger ingredients_audit after insert or update or delete on public.ingredients
  for each row execute function public.audit_row_change();
create trigger recipes_audit after insert or update or delete on public.recipes
  for each row execute function public.audit_row_change();

alter table public.suppliers enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.branch_stock enable row level security;
alter table public.stock_movements enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;

grant select, insert, update on public.suppliers, public.ingredients to authenticated;
grant select, insert, update, delete on public.recipes to authenticated;
grant select on public.branch_stock, public.stock_movements, public.purchase_orders,
  public.purchase_order_lines, public.stock_counts, public.stock_count_lines to authenticated;

create policy suppliers_select on public.suppliers for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager()));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check ((select public.is_admin()));
create policy suppliers_update on public.suppliers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy ingredients_select on public.ingredients for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager()));
create policy ingredients_insert on public.ingredients for insert to authenticated
  with check ((select public.is_admin()));
create policy ingredients_update on public.ingredients for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy recipes_select on public.recipes for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager()));
create policy recipes_insert on public.recipes for insert to authenticated
  with check ((select public.is_admin()));
create policy recipes_update on public.recipes for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy recipes_delete on public.recipes for delete to authenticated
  using ((select public.is_admin()));

-- Branch stock and its history: the branch's managers (and admins).
create policy branch_stock_select on public.branch_stock for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));
create policy stock_movements_select on public.stock_movements for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));
create policy purchase_order_lines_select on public.purchase_order_lines for select to authenticated
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_id and not public.is_device() and public.can_access_branch(po.branch_id)
  ));
create policy stock_counts_select on public.stock_counts for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));
create policy stock_count_lines_select on public.stock_count_lines for select to authenticated
  using (exists (
    select 1 from public.stock_counts c
    where c.id = stock_count_id and not public.is_device() and public.can_access_branch(c.branch_id)
  ));

-- ---------------------------------------------------------------------------
-- Moving stock (internal)
-- ---------------------------------------------------------------------------

-- One movement, and the branch's running total.
create function public.move_stock(
  p_branch_id uuid,
  p_ingredient_id uuid,
  p_type public.stock_movement_type,
  p_quantity numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_reason text default null,
  p_staff_id uuid default null,
  p_unit_cost integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_quantity = 0 then
    return;
  end if;
  insert into public.stock_movements (
    branch_id, ingredient_id, type, quantity, unit_cost, reference_type, reference_id, reason, staff_id
  )
  values (
    p_branch_id, p_ingredient_id, p_type, p_quantity,
    coalesce(p_unit_cost, (select cost_per_unit from public.ingredients where id = p_ingredient_id), 0),
    p_reference_type, p_reference_id, p_reason, p_staff_id
  );
  insert into public.branch_stock as b (branch_id, ingredient_id, quantity_on_hand, updated_at)
  values (p_branch_id, p_ingredient_id, p_quantity, now())
  on conflict (branch_id, ingredient_id)
  do update set quantity_on_hand = b.quantity_on_hand + excluded.quantity_on_hand, updated_at = now();
end;
$$;

-- What some order lines used, per ingredient: each line's item recipe and
-- its modifiers' recipes, times the quantity. Meals count their parts (and
-- the meal itself, e.g. its box). Voided lines used nothing.
create function public.order_lines_usage(p_order_id uuid, p_line_ids uuid[] default null)
returns table (ingredient_id uuid, quantity numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select i.*
    from public.order_items i
    where i.order_id = p_order_id
      and i.status <> 'voided'
      and (p_line_ids is null or i.id = any (p_line_ids) or i.parent_item_id = any (p_line_ids))
  ),
  uses as (
    select r.ingredient_id, r.quantity * l.quantity as quantity
    from lines l
    join public.recipes r on r.menu_item_id = l.menu_item_id
    union all
    select r.ingredient_id, r.quantity * l.quantity
    from lines l
    cross join lateral jsonb_array_elements(coalesce(l.modifiers, '[]'::jsonb)) m
    join public.recipes r on r.modifier_id = (m ->> 'id')::uuid
  )
  select ingredient_id, sum(quantity) from uses group by ingredient_id;
$$;

-- Takes a paid order's ingredients out of stock, once.
create function public.deduct_order_stock(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  u record;
begin
  update public.orders set stock_deducted_at = now()
  where id = p_order_id and stock_deducted_at is null
  returning * into v_order;
  if v_order.id is null then
    return;
  end if;
  for u in select * from public.order_lines_usage(p_order_id) loop
    perform public.move_stock(
      v_order.branch_id, u.ingredient_id, 'sale', -u.quantity, 'order', p_order_id, null, v_order.staff_id
    );
  end loop;
end;
$$;

-- An order's stock comes out when it's paid (online or offline, whichever
-- RPC set paid_at).
create function public.orders_deduct_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.deduct_order_stock(new.id);
  return new;
end;
$$;

create trigger orders_deduct_stock
  after update of paid_at on public.orders
  for each row
  when (old.paid_at is null and new.paid_at is not null)
  execute function public.orders_deduct_stock();

-- A refund whose items went back on the shelf returns their ingredients.
create function public.return_refund_stock(p_refund_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds;
  u record;
begin
  select * into v_refund from public.refunds where id = p_refund_id;
  if v_refund.id is null
    or exists (select 1 from public.stock_movements where reference_type = 'refund' and reference_id = p_refund_id) then
    return;
  end if;
  -- Refunded lines are voided if the kitchen hadn't made them; count them anyway.
  for u in
    with lines as (
      select i.* from public.order_items i
      where i.order_id = v_refund.order_id
        and (i.id = any (v_refund.line_ids) or i.parent_item_id = any (v_refund.line_ids))
    ),
    uses as (
      select r.ingredient_id, r.quantity * l.quantity as quantity
      from lines l join public.recipes r on r.menu_item_id = l.menu_item_id
      union all
      select r.ingredient_id, r.quantity * l.quantity
      from lines l
      cross join lateral jsonb_array_elements(coalesce(l.modifiers, '[]'::jsonb)) m
      join public.recipes r on r.modifier_id = (m ->> 'id')::uuid
    )
    select ingredient_id, sum(quantity) as quantity from uses group by ingredient_id
  loop
    perform public.move_stock(
      v_refund.branch_id, u.ingredient_id, 'refund_return', u.quantity, 'refund', p_refund_id,
      v_refund.reason, v_refund.staff_id
    );
  end loop;
end;
$$;

-- The staff member managing a branch's stock, or an error.
create function public.require_stock_manager(p_branch_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.is_device()
    or not public.has_permission('inventory.manage')
    or not public.can_access_branch(p_branch_id)
    or not exists (select 1 from public.branches where id = p_branch_id and is_active) then
    raise exception 'You can''t manage this branch''s stock' using errcode = '42501';
  end if;
  return public.current_staff_id();
end;
$$;

-- Ingredient lines as sent: [{"ingredient_id", "quantity", ...}]. Raises
-- for anything malformed; quantities must be positive.
create function public.stock_lines(p_lines jsonb)
returns table (ingredient_id uuid, quantity numeric, unit_cost integer, reason text, line jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one ingredient' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Too many lines' using errcode = '22023';
  end if;
  begin
    return query
    select (e ->> 'ingredient_id')::uuid,
           (e ->> 'quantity')::numeric,
           nullif(e ->> 'unit_cost', '')::integer,
           nullif(btrim(e ->> 'reason'), ''),
           e
    from jsonb_array_elements(p_lines) e;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'A line wasn''t sent correctly' using errcode = '22023';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Stock actions (managers, in the back office)
-- ---------------------------------------------------------------------------

-- Waste with a reason per line. p_waste: {id, lines: [{ingredient_id,
-- quantity, reason}]}. Safe to repeat (same id).
create function public.record_waste(p_branch_id uuid, p_waste jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.require_stock_manager(p_branch_id);
  v_id uuid;
  l record;
  v_count integer := 0;
begin
  begin
    v_id := (p_waste ->> 'id')::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  if v_id is null then
    raise exception 'The waste wasn''t sent correctly' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements where reference_type = 'waste' and reference_id = v_id) then
    return;
  end if;
  for l in select * from public.stock_lines(p_waste -> 'lines') loop
    if l.quantity is null or l.quantity <= 0 then
      raise exception 'Waste quantities must be more than zero' using errcode = '22023';
    end if;
    if l.reason is null then
      raise exception 'Give a reason for each line of waste' using errcode = '22023';
    end if;
    if not exists (select 1 from public.ingredients where id = l.ingredient_id) then
      raise exception 'Unknown ingredient' using errcode = '22023';
    end if;
    perform public.move_stock(p_branch_id, l.ingredient_id, 'waste', -l.quantity, 'waste', v_id, l.reason, v_staff);
    v_count := v_count + 1;
  end loop;
  perform public.write_audit(
    p_action => 'stock.waste',
    p_entity => 'stock_movements',
    p_entity_id => v_id::text,
    p_after => p_waste -> 'lines',
    p_branch_id => p_branch_id
  );
end;
$$;

-- Moves stock to another branch straight away. p_transfer: {id,
-- to_branch_id, note, lines: [{ingredient_id, quantity}]}. Safe to repeat.
create function public.transfer_stock(p_branch_id uuid, p_transfer jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.require_stock_manager(p_branch_id);
  v_id uuid;
  v_to uuid;
  v_note text := nullif(btrim(p_transfer ->> 'note'), '');
  l record;
begin
  begin
    v_id := (p_transfer ->> 'id')::uuid;
    v_to := (p_transfer ->> 'to_branch_id')::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  if v_id is null or v_to is null then
    raise exception 'The transfer wasn''t sent correctly' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_movements where reference_type = 'transfer' and reference_id = v_id) then
    return;
  end if;
  if v_to = p_branch_id or not exists (select 1 from public.branches where id = v_to and is_active) then
    raise exception 'Choose another branch to send the stock to' using errcode = '22023';
  end if;
  for l in select * from public.stock_lines(p_transfer -> 'lines') loop
    if l.quantity is null or l.quantity <= 0 then
      raise exception 'Transfer quantities must be more than zero' using errcode = '22023';
    end if;
    perform public.move_stock(p_branch_id, l.ingredient_id, 'transfer_out', -l.quantity, 'transfer', v_id, v_note, v_staff);
    perform public.move_stock(v_to, l.ingredient_id, 'transfer_in', l.quantity, 'transfer', v_id, v_note, v_staff);
  end loop;
  perform public.write_audit(
    p_action => 'stock.transfer',
    p_entity => 'stock_movements',
    p_entity_id => v_id::text,
    p_after => jsonb_build_object('to_branch_id', v_to, 'lines', p_transfer -> 'lines'),
    p_reason => v_note,
    p_branch_id => p_branch_id
  );
end;
$$;

-- Saves a draft purchase order (create, or replace a draft's lines).
-- p_order: {id, supplier_id, expected_on, notes, lines: [{ingredient_id,
-- quantity, unit_cost}]}.
create function public.save_purchase_order(p_branch_id uuid, p_order jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.require_stock_manager(p_branch_id);
  v_id uuid;
  v_supplier uuid;
  v_expected date;
  v_existing public.purchase_orders;
  l record;
begin
  begin
    v_id := (p_order ->> 'id')::uuid;
    v_supplier := (p_order ->> 'supplier_id')::uuid;
    v_expected := nullif(p_order ->> 'expected_on', '')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'The purchase order wasn''t sent correctly' using errcode = '22023';
  end;
  if v_id is null or v_supplier is null
    or not exists (select 1 from public.suppliers where id = v_supplier and is_active) then
    raise exception 'Choose a supplier' using errcode = '22023';
  end if;
  select * into v_existing from public.purchase_orders where id = v_id for update;
  if v_existing.id is not null then
    if v_existing.branch_id <> p_branch_id then
      raise exception 'That purchase order id is already in use' using errcode = '23505';
    end if;
    if v_existing.status <> 'draft' then
      raise exception 'Only a draft can be changed' using errcode = '22023';
    end if;
    update public.purchase_orders
    set supplier_id = v_supplier, expected_on = v_expected, notes = nullif(btrim(p_order ->> 'notes'), '')
    where id = v_id;
    delete from public.purchase_order_lines where purchase_order_id = v_id;
  else
    insert into public.purchase_orders (id, branch_id, supplier_id, expected_on, notes, created_by)
    values (v_id, p_branch_id, v_supplier, v_expected, nullif(btrim(p_order ->> 'notes'), ''), v_staff);
  end if;
  for l in select * from public.stock_lines(p_order -> 'lines') loop
    if l.quantity is null or l.quantity <= 0 or coalesce(l.unit_cost, 0) < 0 then
      raise exception 'Order quantities must be more than zero' using errcode = '22023';
    end if;
    insert into public.purchase_order_lines (purchase_order_id, ingredient_id, quantity, unit_cost)
    values (v_id, l.ingredient_id, l.quantity,
      coalesce(l.unit_cost, (select cost_per_unit from public.ingredients where id = l.ingredient_id), 0))
    on conflict (purchase_order_id, ingredient_id)
    do update set quantity = public.purchase_order_lines.quantity + excluded.quantity;
  end loop;
  perform public.write_audit(
    p_action => 'purchase_order.saved',
    p_entity => 'purchase_orders',
    p_entity_id => v_id::text,
    p_before => case when v_existing.id is null then null
      else jsonb_build_object('supplier_id', v_existing.supplier_id, 'expected_on', v_existing.expected_on) end,
    p_after => jsonb_build_object(
      'supplier_id', v_supplier,
      'expected_on', v_expected,
      'lines', (select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'quantity', quantity, 'unit_cost', unit_cost))
        from public.purchase_order_lines where purchase_order_id = v_id)),
    p_branch_id => p_branch_id
  );
  return v_id;
end;
$$;

-- Marks a purchase order sent to the supplier, or cancels it.
create function public.set_purchase_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  perform public.require_stock_manager(v_order.branch_id);
  if p_status = 'sent' and v_order.status = 'draft' then
    update public.purchase_orders set status = 'sent', sent_at = now() where id = p_order_id;
  elsif p_status = 'cancelled' and v_order.status in ('draft', 'sent') then
    update public.purchase_orders set status = 'cancelled' where id = p_order_id;
  elsif p_status::text <> v_order.status::text then
    raise exception 'That purchase order can''t be changed now' using errcode = '22023';
  end if;
  perform public.write_audit(
    p_action => 'purchase_order.' || p_status,
    p_entity => 'purchase_orders',
    p_entity_id => p_order_id::text,
    p_before => jsonb_build_object('status', v_order.status),
    p_branch_id => v_order.branch_id
  );
end;
$$;

-- Receives a delivery against a purchase order: what came and what it
-- cost can differ from what was ordered. p_lines: [{ingredient_id,
-- quantity, unit_cost}] (lines not mentioned arrived as ordered).
create function public.receive_purchase_order(p_order_id uuid, p_lines jsonb default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_staff uuid;
  l record;
  v_given jsonb;
  v_quantity numeric;
  v_cost integer;
begin
  select * into v_order from public.purchase_orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  v_staff := public.require_stock_manager(v_order.branch_id);
  if v_order.status = 'received' then
    return;
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'That purchase order was cancelled' using errcode = '22023';
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The delivery wasn''t sent correctly' using errcode = '22023';
  end if;

  for l in select * from public.purchase_order_lines where purchase_order_id = p_order_id loop
    select e into v_given from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) e
    where e ->> 'ingredient_id' = l.ingredient_id::text;
    begin
      v_quantity := coalesce((v_given ->> 'quantity')::numeric, l.quantity);
      v_cost := coalesce(nullif(v_given ->> 'unit_cost', '')::integer, l.unit_cost);
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'The delivery wasn''t sent correctly' using errcode = '22023';
    end;
    if v_quantity < 0 or v_cost < 0 then
      raise exception 'Delivered quantities and costs can''t be below zero' using errcode = '22023';
    end if;
    update public.purchase_order_lines
    set received_quantity = v_quantity, received_unit_cost = v_cost
    where id = l.id;
    if v_quantity > 0 then
      perform public.move_stock(
        v_order.branch_id, l.ingredient_id, 'receive', v_quantity, 'purchase_order', p_order_id, null, v_staff, v_cost
      );
      -- The latest price paid becomes the ingredient's cost.
      update public.ingredients set cost_per_unit = v_cost where id = l.ingredient_id and v_cost > 0;
    end if;
  end loop;

  update public.purchase_orders
  set status = 'received', received_at = now(), received_by = v_staff
  where id = p_order_id;
  perform public.write_audit(
    p_action => 'purchase_order.received',
    p_entity => 'purchase_orders',
    p_entity_id => p_order_id::text,
    p_after => (select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'ordered', quantity,
      'received', received_quantity, 'unit_cost', received_unit_cost))
      from public.purchase_order_lines where purchase_order_id = p_order_id),
    p_branch_id => v_order.branch_id
  );
end;
$$;

-- A stock count: what's on the shelf for everything (or one category).
-- Waits for approval before stock is adjusted. p_count: {id, category,
-- lines: [{ingredient_id, quantity}]} (quantity = counted). Safe to repeat.
create function public.submit_stock_count(p_branch_id uuid, p_count jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.require_stock_manager(p_branch_id);
  v_id uuid;
  l record;
begin
  begin
    v_id := (p_count ->> 'id')::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  if v_id is null then
    raise exception 'The count wasn''t sent correctly' using errcode = '22023';
  end if;
  if exists (select 1 from public.stock_counts where id = v_id) then
    return v_id;
  end if;
  insert into public.stock_counts (id, branch_id, category, counted_by)
  values (v_id, p_branch_id, nullif(btrim(p_count ->> 'category'), ''), v_staff);
  for l in select * from public.stock_lines(p_count -> 'lines') loop
    if l.quantity is null or l.quantity < 0 then
      raise exception 'Counts can''t be below zero' using errcode = '22023';
    end if;
    insert into public.stock_count_lines (stock_count_id, ingredient_id, expected, counted)
    values (
      v_id, l.ingredient_id,
      coalesce((select quantity_on_hand from public.branch_stock where branch_id = p_branch_id and ingredient_id = l.ingredient_id), 0),
      l.quantity
    );
  end loop;
  perform public.write_audit(
    p_action => 'stock.count',
    p_entity => 'stock_counts',
    p_entity_id => v_id::text,
    p_after => (select jsonb_build_object('lines', count(*), 'variance', sum(variance))
      from public.stock_count_lines where stock_count_id = v_id),
    p_branch_id => p_branch_id
  );
  return v_id;
end;
$$;

-- Approves a count (stock is adjusted by each line's variance, keeping
-- sales made since the count) or rejects it.
create function public.review_stock_count(p_count_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count public.stock_counts;
  v_staff uuid;
  l record;
begin
  select * into v_count from public.stock_counts where id = p_count_id for update;
  if v_count.id is null then
    raise exception 'Count not found' using errcode = 'P0002';
  end if;
  v_staff := public.require_stock_manager(v_count.branch_id);
  if v_count.status <> 'pending' then
    raise exception 'This count has already been reviewed' using errcode = '22023';
  end if;
  if p_approve then
    for l in select * from public.stock_count_lines where stock_count_id = p_count_id and variance <> 0 loop
      perform public.move_stock(
        v_count.branch_id, l.ingredient_id, 'count_adjust', l.variance, 'stock_count', p_count_id,
        'Stock count', v_staff
      );
    end loop;
  end if;
  update public.stock_counts
  set status = case when p_approve then 'approved'::public.stock_count_status else 'rejected'::public.stock_count_status end,
      reviewed_by = v_staff, reviewed_at = now(), review_note = nullif(btrim(p_note), '')
  where id = p_count_id;
  perform public.write_audit(
    p_action => case when p_approve then 'stock.count_approved' else 'stock.count_rejected' end,
    p_entity => 'stock_counts',
    p_entity_id => p_count_id::text,
    p_reason => nullif(btrim(p_note), ''),
    p_branch_id => v_count.branch_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Per ingredient for a branch: on hand and its value, and between two dates
-- (branch time): theoretical usage (from recipes of what was sold),
-- waste, count differences and the actual usage they imply, receipts,
-- transfers and refunds put back.
create function public.inventory_report(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  perform public.require_stock_manager(p_branch_id);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose dates up to a year apart' using errcode = '22023';
  end if;
  select timezone into v_tz from public.branches where id = p_branch_id;
  return jsonb_build_object(
    'ingredients', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.name)
      from (
        select i.id, i.name, i.unit, i.category, i.cost_per_unit, i.reorder_level, i.is_active,
               coalesce(b.quantity_on_hand, 0) as on_hand,
               round(coalesce(b.quantity_on_hand, 0) * i.cost_per_unit)::bigint as value,
               coalesce(-sum(m.quantity) filter (where m.type = 'sale'), 0) as theoretical,
               coalesce(-sum(m.quantity) filter (where m.type = 'waste'), 0) as waste,
               coalesce(sum(m.quantity) filter (where m.type = 'count_adjust'), 0) as count_adjust,
               coalesce(sum(m.quantity) filter (where m.type = 'receive'), 0) as received,
               coalesce(sum(m.quantity) filter (where m.type in ('transfer_in', 'transfer_out')), 0) as transferred,
               coalesce(sum(m.quantity) filter (where m.type = 'refund_return'), 0) as returned,
               -- Actual usage: what was sold and wasted, plus stock that went
               -- missing (counted short), less what came back.
               coalesce(-sum(m.quantity) filter (where m.type in ('sale', 'waste', 'count_adjust', 'refund_return')), 0)
                 as actual
        from public.ingredients i
        left join public.branch_stock b on b.ingredient_id = i.id and b.branch_id = p_branch_id
        left join public.stock_movements m
          on m.ingredient_id = i.id and m.branch_id = p_branch_id
          and (m.created_at at time zone v_tz)::date between p_from and p_to
        group by i.id, b.quantity_on_hand
      ) x
      where x.is_active or x.on_hand <> 0
    ), '[]'::jsonb),
    'waste_by_reason', coalesce((
      select jsonb_agg(jsonb_build_object('reason', reason, 'lines', n, 'value', value) order by value desc)
      from (
        select m.reason, count(*) as n, round(sum(-m.quantity * m.unit_cost))::bigint as value
        from public.stock_movements m
        where m.branch_id = p_branch_id and m.type = 'waste'
          and (m.created_at at time zone v_tz)::date between p_from and p_to
        group by m.reason
      ) w
    ), '[]'::jsonb)
  );
end;
$$;

-- What to order: average daily use over the last p_days, enough to cover
-- the next p_days plus the reorder level, less what's on hand.
create function public.suggest_purchase(p_branch_id uuid, p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_stock_manager(p_branch_id);
  if p_days not between 1 and 60 then
    raise exception 'Choose between 1 and 60 days' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(s)::jsonb order by s.supplier_name nulls last, s.name)
    from (
      select i.id as ingredient_id, i.name, i.unit, i.cost_per_unit, i.supplier_id, sup.name as supplier_name,
             coalesce(b.quantity_on_hand, 0) as on_hand, i.reorder_level,
             round(coalesce(u.used, 0) / p_days, 3) as daily_use,
             ceil(greatest(coalesce(u.used, 0) + i.reorder_level - coalesce(b.quantity_on_hand, 0), 0)) as suggested
      from public.ingredients i
      left join public.suppliers sup on sup.id = i.supplier_id
      left join public.branch_stock b on b.ingredient_id = i.id and b.branch_id = p_branch_id
      left join lateral (
        select -sum(m.quantity) as used
        from public.stock_movements m
        where m.branch_id = p_branch_id and m.ingredient_id = i.id and m.type in ('sale', 'waste')
          and m.created_at >= now() - make_interval(days => p_days)
      ) u on true
      where i.is_active
    ) s
    where s.suggested > 0
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sample ingredients and recipes for the sample menu (admins)
-- ---------------------------------------------------------------------------

create function public.load_sample_inventory()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_supplier uuid;
  v_produce uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can set up inventory' using errcode = '42501';
  end if;
  if exists (select 1 from public.ingredients) then
    raise exception 'There are ingredients already. The sample can only be added to an empty list.'
      using errcode = '22023';
  end if;

  insert into public.suppliers (name, phone) values ('Fresh Foods Ltd', '+233 30 000 0000') returning id into v_produce;
  insert into public.suppliers (name, phone) values ('Packaging & Drinks Co', '+233 30 000 0001') returning id into v_supplier;

  insert into public.ingredients (name, unit, category, cost_per_unit, reorder_level, supplier_id) values
    ('Chicken piece', 'pc', 'Meat', 400, 60, v_produce),
    ('Burger patty', 'pc', 'Meat', 350, 30, v_produce),
    ('Bacon slice', 'pc', 'Meat', 150, 20, v_produce),
    ('Bun', 'pc', 'Bakery', 80, 40, v_produce),
    ('Tortilla', 'pc', 'Bakery', 60, 30, v_produce),
    ('Cheese slice', 'pc', 'Dairy', 70, 30, v_produce),
    ('Potato', 'kg', 'Produce', 900, 10, v_produce),
    ('Coleslaw', 'kg', 'Produce', 1500, 3, v_produce),
    ('Lettuce', 'kg', 'Produce', 1000, 2, v_produce),
    ('Rice', 'kg', 'Dry goods', 1200, 5, v_produce),
    ('Soft drink syrup', 'l', 'Drinks', 6000, 3, v_supplier),
    ('Water bottle', 'pc', 'Drinks', 150, 24, v_supplier),
    ('Coke 1.5 L bottle', 'pc', 'Drinks', 1200, 12, v_supplier),
    ('Cup', 'pc', 'Packaging', 30, 100, v_supplier),
    ('Meal box', 'pc', 'Packaging', 150, 50, v_supplier),
    ('Burger box', 'pc', 'Packaging', 60, 50, v_supplier),
    ('Fries bag', 'pc', 'Packaging', 20, 100, v_supplier),
    ('Side tub', 'pc', 'Packaging', 25, 100, v_supplier);

  -- Menu items, by name.
  insert into public.recipes (menu_item_id, ingredient_id, quantity)
  select mi.id, ing.id, x.quantity
  from (values
    ('2-piece chicken', 'Chicken piece', 2),
    ('3-piece chicken', 'Chicken piece', 3),
    ('8-piece chicken', 'Chicken piece', 8),
    ('8-piece chicken', 'Meal box', 1),
    ('Chicken wings (6)', 'Chicken piece', 3),
    ('Chicken burger', 'Chicken piece', 1),
    ('Chicken burger', 'Bun', 1),
    ('Chicken burger', 'Lettuce', 0.02),
    ('Chicken burger', 'Burger box', 1),
    ('Cheeseburger', 'Burger patty', 1),
    ('Cheeseburger', 'Bun', 1),
    ('Cheeseburger', 'Cheese slice', 1),
    ('Cheeseburger', 'Burger box', 1),
    ('Chicken wrap', 'Tortilla', 1),
    ('Chicken wrap', 'Chicken piece', 1),
    ('Chicken wrap', 'Lettuce', 0.02),
    ('Veggie wrap', 'Tortilla', 1),
    ('Veggie wrap', 'Lettuce', 0.05),
    ('Fries', 'Potato', 0.15),
    ('Fries', 'Fries bag', 1),
    ('Coleslaw', 'Coleslaw', 0.1),
    ('Coleslaw', 'Side tub', 1),
    ('Rice', 'Rice', 0.12),
    ('Rice', 'Side tub', 1),
    ('Coke', 'Soft drink syrup', 0.05),
    ('Coke', 'Cup', 1),
    ('Fanta', 'Soft drink syrup', 0.05),
    ('Fanta', 'Cup', 1),
    ('Sprite', 'Soft drink syrup', 0.05),
    ('Sprite', 'Cup', 1),
    ('Water', 'Water bottle', 1),
    ('Coke 1.5 L', 'Coke 1.5 L bottle', 1),
    ('2-piece meal', 'Meal box', 1)
  ) as x (item, ingredient, quantity)
  join public.menu_items mi on lower(mi.name) = lower(x.item)
  join public.ingredients ing on ing.name = x.ingredient
  on conflict do nothing;

  -- Modifiers, by group and name: a Large takes more.
  insert into public.recipes (modifier_id, ingredient_id, quantity)
  select m.id, ing.id, x.quantity
  from (values
    ('Fries size', 'Large', 'Potato', 0.08),
    ('Drink size', 'Large', 'Soft drink syrup', 0.03),
    ('Extras', 'Extra cheese', 'Cheese slice', 1),
    ('Extras', 'Bacon', 'Bacon slice', 1)
  ) as x (grp, modifier, ingredient, quantity)
  join public.modifier_groups g on lower(g.name) = lower(x.grp)
  join public.modifiers m on m.group_id = g.id and lower(m.name) = lower(x.modifier)
  join public.ingredients ing on ing.name = x.ingredient
  on conflict do nothing;
end;
$$;

-- Refunds can put items back in stock (return_to_stock).
create or replace function public.refund_order(p_session_id uuid, p_refund jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_shift public.shifts;
  v_id uuid;
  v_order_id uuid;
  v_override_id uuid;
  v_method public.payment_methods;
  v_order public.orders;
  v_existing public.refunds;
  v_line_ids uuid[];
  v_requested uuid[];
  v_reason text := nullif(btrim(p_refund ->> 'reason'), '');
  v_reference text := nullif(btrim(p_refund ->> 'reference'), '');
  v_refunded bigint;
  v_amount bigint;
  v_approver_id uuid;
  v_return boolean;
begin
  if p_refund is null or jsonb_typeof(p_refund) <> 'object' then
    raise exception 'The refund wasn''t sent correctly' using errcode = '22023';
  end if;
  begin
    v_id := (p_refund ->> 'id')::uuid;
    v_order_id := (p_refund ->> 'order_id')::uuid;
    v_override_id := nullif(p_refund ->> 'override_id', '')::uuid;
    select * into v_method from public.payment_methods
    where id = nullif(p_refund ->> 'payment_method_id', '')::uuid;
    select coalesce(array_agg(x::uuid), '{}') into v_requested
    from jsonb_array_elements_text(coalesce(nullif(p_refund -> 'line_ids', 'null'::jsonb), '[]'::jsonb)) as x;
  exception when invalid_text_representation then
    raise exception 'The refund wasn''t sent correctly' using errcode = '22023';
  end;
  if v_id is null or v_order_id is null then
    raise exception 'The refund wasn''t sent correctly' using errcode = '22023';
  end if;
  begin
    v_return := coalesce((p_refund ->> 'return_to_stock')::boolean, false);
  exception when invalid_text_representation then
    raise exception 'The refund wasn''t sent correctly' using errcode = '22023';
  end;

  perform pg_advisory_xact_lock(hashtextextended(v_order_id::text, 1));
  select * into v_existing from public.refunds where id = v_id;
  if v_existing.id is not null then
    if v_existing.order_id <> v_order_id then
      raise exception 'That refund id is already in use' using errcode = '23505';
    end if;
    return public.order_summary(v_order_id);
  end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if v_order.id is null or v_order.branch_id <> v_session.branch_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.paid_at is null then
    raise exception 'This order isn''t paid. Void its items instead.' using errcode = '22023';
  end if;
  if v_order.status = 'refunded' then
    raise exception 'This order is already refunded' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for the refund' using errcode = '22023';
  end if;
  if v_method.id is null or not v_method.is_enabled then
    raise exception 'Choose how the money goes back' using errcode = '22023';
  end if;
  if v_method.requires_reference and v_reference is null and v_method.type <> 'cash' then
    raise exception '% refunds need a reference number', v_method.name using errcode = '22023';
  end if;

  v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);

  if not public.staff_has_permission(v_session.staff_id, 'order.refund') then
    if v_override_id is null then
      raise exception 'Refunds need a manager''s approval' using errcode = '42501';
    end if;
    v_approver_id := public.consume_override(v_override_id, v_session.branch_id, 'order.refund');
  end if;

  select coalesce(sum(amount), 0) into v_refunded from public.refunds where order_id = v_order_id;
  if cardinality(v_requested) = 0 then
    -- Everything that's left.
    select coalesce(array_agg(id), '{}') into v_line_ids
    from public.order_items
    where order_id = v_order_id and parent_item_id is null and status <> 'voided' and refunded_at is null;
    v_amount := v_order.total - v_refunded;
  else
    if exists (
      select 1 from unnest(v_requested) as x(id)
      where not exists (
        select 1 from public.order_items li
        where li.id = x.id and li.order_id = v_order_id and li.parent_item_id is null
          and li.status <> 'voided' and li.refunded_at is null
      )
    ) then
      raise exception 'Those items can''t be refunded (already refunded, or not on this order)' using errcode = '22023';
    end if;
    v_line_ids := v_requested;
    select coalesce(sum(line_total), 0) into v_amount from public.order_items where id = any (v_line_ids);
  end if;
  if v_amount <= 0 or v_amount > v_order.total - v_refunded then
    raise exception 'There''s nothing left to refund' using errcode = '22023';
  end if;

  insert into public.refunds (
    id, order_id, branch_id, shift_id, amount, payment_method_id, method, method_name, reference, reason,
    line_ids, staff_id, approved_by, device_id, pos_session_id, client_created_at, returned_to_stock
  )
  values (
    v_id, v_order_id, v_order.branch_id, v_shift.id, v_amount, v_method.id, v_method.type, v_method.name,
    v_reference, v_reason, v_line_ids, v_session.staff_id, v_approver_id, v_session.device_id, v_session.id,
    case when p_refund ? 'client_created_at' then (p_refund ->> 'client_created_at')::timestamptz end,
    v_return
  );
  -- Items put back on the shelf (never made, or unopened) go back in stock.
  if v_return then
    perform public.return_refund_stock(v_id);
  end if;

  update public.order_items
  set refunded_at = now(), refund_id = v_id
  where id = any (v_line_ids);
  -- The kitchen stops making what was refunded before it was ready.
  update public.order_items
  set status = 'voided', voided_at = now(), void_reason = 'Refunded: ' || v_reason,
      voided_by = v_session.staff_id, approved_by = v_approver_id
  where (id = any (v_line_ids) or parent_item_id = any (v_line_ids)) and status in ('pending', 'sent');

  update public.orders
  set status = case
    when v_refunded + v_amount >= total then 'refunded'::public.order_status
    else 'partially_refunded'::public.order_status
  end
  where id = v_order_id;
  if v_refunded + v_amount >= v_order.total then
    update public.payments set status = 'refunded' where order_id = v_order_id;
  end if;

  perform public.write_audit(
    p_action => 'order.refund',
    p_entity => 'orders',
    p_entity_id => v_order_id::text,
    p_after => jsonb_build_object(
      'order_number', v_order.order_number, 'refund_id', v_id, 'amount', v_amount,
      'method', v_method.name, 'lines', to_jsonb(v_line_ids)
    ),
    p_reason => v_reason,
    p_branch_id => v_order.branch_id,
    p_approver_staff_id => v_approver_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return public.order_summary(v_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.move_stock(uuid, uuid, public.stock_movement_type, numeric, text, uuid, text, uuid, integer),
  public.order_lines_usage(uuid, uuid[]),
  public.deduct_order_stock(uuid),
  public.orders_deduct_stock(),
  public.return_refund_stock(uuid),
  public.require_stock_manager(uuid),
  public.stock_lines(jsonb),
  public.record_waste(uuid, jsonb),
  public.transfer_stock(uuid, jsonb),
  public.save_purchase_order(uuid, jsonb),
  public.set_purchase_order_status(uuid, text),
  public.receive_purchase_order(uuid, jsonb),
  public.submit_stock_count(uuid, jsonb),
  public.review_stock_count(uuid, boolean, text),
  public.inventory_report(uuid, date, date),
  public.suggest_purchase(uuid, integer),
  public.load_sample_inventory()
from public, anon, authenticated;

grant execute on function
  public.record_waste(uuid, jsonb),
  public.transfer_stock(uuid, jsonb),
  public.save_purchase_order(uuid, jsonb),
  public.set_purchase_order_status(uuid, text),
  public.receive_purchase_order(uuid, jsonb),
  public.submit_stock_count(uuid, jsonb),
  public.review_stock_count(uuid, boolean, text),
  public.inventory_report(uuid, date, date),
  public.suggest_purchase(uuid, integer),
  public.load_sample_inventory()
to authenticated;
