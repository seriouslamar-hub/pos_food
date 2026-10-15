-- Phase 6: payments, pay-later dine-in, and receipt data.

create type public.payment_status as enum ('captured', 'refunded');

create table public.payments (
  id uuid primary key,
  order_id uuid not null references public.orders (id),
  branch_id uuid not null references public.branches (id),
  -- Phase 7 makes shifts required for new payments.
  shift_id uuid,
  payment_method_id uuid not null references public.payment_methods (id),
  -- Snapshots, so renaming a method doesn't change old receipts.
  method public.payment_method_type not null,
  method_name text not null,
  -- The part of the order this payment covers.
  amount integer not null check (amount > 0),
  -- Cash only: what the customer handed over, and the change given back.
  tendered integer check (tendered is null or tendered >= amount),
  change_given integer check (change_given is null or change_given >= 0),
  reference text,
  status public.payment_status not null default 'captured',
  staff_id uuid references public.staff (id),
  device_id uuid references public.devices (id),
  pos_session_id uuid references public.pos_sessions (id),
  is_offline boolean not null default false,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payments_cash_fields check (
    (method = 'cash') = (tendered is not null and change_given is not null)
  )
);
create index payments_order_idx on public.payments (order_id);
create index payments_branch_created_idx on public.payments (branch_id, created_at desc);
create index payments_method_idx on public.payments (payment_method_id);
create index payments_staff_idx on public.payments (staff_id);
create index payments_device_idx on public.payments (device_id);
create index payments_session_idx on public.payments (pos_session_id);

alter table public.payments enable row level security;
grant select on public.payments to authenticated;
create policy payments_select on public.payments
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      branch_id = (select public.current_branch_id())
      and ((select public.is_manager()) or (select public.is_device()))
    )
  );

insert into public.settings (branch_id, key, value) values
  (null, 'orders.pay_later_dine_in', 'false'),
  (null, 'print.kitchen_tickets', 'false'),
  (null, 'receipt.auto_print', 'false')
on conflict on constraint settings_branch_key_unique do nothing;

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

-- A setting for a branch: its own value, else the global default.
create function public.branch_setting(p_branch_id uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.value
  from public.settings s
  where s.key = p_key and (s.branch_id = p_branch_id or s.branch_id is null)
  order by s.branch_id nulls last
  limit 1;
$$;

-- Marks an order as sent to the kitchen (once) and its waiting lines as sent.
create function public.send_order_lines_to_kitchen(p_order_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.orders
  set sent_to_kitchen_at = coalesce(sent_to_kitchen_at, now())
  where id = p_order_id;
  update public.order_items
  set status = 'sent'
  where order_id = p_order_id and status = 'pending';
$$;

-- ---------------------------------------------------------------------------
-- Receipt data: the order summary now carries payments and the branch's
-- receipt details, so a receipt can be printed from it alone.
-- ---------------------------------------------------------------------------

create or replace function public.order_summary(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'branch_id', o.branch_id,
    'order_number', o.order_number,
    'status', o.status,
    'order_type', o.order_type,
    'channel', o.channel,
    'business_date', o.business_date,
    'created_at', o.created_at,
    'customer_phone', o.customer_phone,
    'delivery_address', o.delivery_address,
    'notes', o.notes,
    'subtotal', o.subtotal,
    'discount_total', o.discount_total,
    'tax_total', o.tax_total,
    'total', o.total,
    'paid_at', o.paid_at,
    'sent_to_kitchen_at', o.sent_to_kitchen_at,
    'staff_name', s.full_name,
    'device_code', d.code,
    'branch', jsonb_build_object(
      'name', b.name,
      'address', b.address,
      'phone', b.phone,
      'receipt_header', b.receipt_header,
      'receipt_footer', b.receipt_footer,
      'logo_url', b.logo_url,
      'timezone', b.timezone,
      'currency_code', b.currency_code
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', li.id,
        'menu_item_id', li.menu_item_id,
        'name', li.name_snapshot,
        'short_name', li.short_name_snapshot,
        'quantity', li.quantity,
        'unit_price', li.unit_price,
        'modifiers', li.modifiers,
        'notes', li.notes,
        'line_subtotal', li.line_subtotal,
        'line_discount', li.line_discount,
        'line_tax', li.line_tax,
        'line_total', li.line_total,
        'status', li.status,
        'kds_station_id', li.kds_station_id,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.id, 'name', c.name_snapshot, 'short_name', c.short_name_snapshot,
            'slot', c.combo_slot_name, 'modifiers', c.modifiers, 'kds_station_id', c.kds_station_id
          ) order by c.sort_order)
          from public.order_items c where c.parent_item_id = li.id
        ), '[]'::jsonb)
      ) order by li.sort_order)
      from public.order_items li
      where li.order_id = o.id and li.parent_item_id is null
    ), '[]'::jsonb),
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', t.name, 'rate_bps', t.rate_bps, 'inclusive', t.inclusive, 'amount', t.amount
      ) order by t.inclusive desc, t.name)
      from (
        select x ->> 'name' as name, (x ->> 'rate_bps')::integer as rate_bps,
               (x ->> 'inclusive')::boolean as inclusive, sum((x ->> 'amount')::integer) as amount
        from public.order_items li
        cross join jsonb_array_elements(li.taxes) x
        where li.order_id = o.id and li.status <> 'voided'
        group by 1, 2, 3
      ) t
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'method', p.method, 'method_name', p.method_name, 'amount', p.amount,
        'tendered', p.tendered, 'change_given', p.change_given, 'reference', p.reference,
        'status', p.status
      ) order by p.created_at, p.id)
      from public.payments p where p.order_id = o.id
    ), '[]'::jsonb),
    'amount_paid', coalesce((
      select sum(p.amount) from public.payments p where p.order_id = o.id and p.status = 'captured'
    ), 0),
    'change_given', coalesce((
      select sum(p.change_given) from public.payments p where p.order_id = o.id
    ), 0)
  )
  from public.orders o
  join public.branches b on b.id = o.branch_id
  left join public.staff s on s.id = o.staff_id
  left join public.devices d on d.id = o.device_id
  where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- record_payments: all of an order's payments in one go.
-- ---------------------------------------------------------------------------

create function public.record_payments(p_session_id uuid, p_order_id uuid, p_payments jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_order public.orders;
  v_ids uuid[];
  v_existing integer;
  v_payment jsonb;
  v_method public.payment_methods;
  v_amount integer;
  v_tendered integer;
  v_reference text;
  v_sum bigint := 0;
  v_summary jsonb := '[]'::jsonb;
begin
  if not public.staff_has_permission(v_session.staff_id, 'order.create') then
    raise exception 'You are not allowed to take payments' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 1));
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.branch_id <> v_session.branch_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'The payments weren''t sent correctly' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payments) > 10 then
    raise exception 'An order can have at most 10 payments' using errcode = '22023';
  end if;

  begin
    select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_ids from jsonb_array_elements(p_payments) e;
  exception when invalid_text_representation then
    raise exception 'Each payment needs an id' using errcode = '22023';
  end;
  if exists (select 1 from unnest(v_ids) as x where x is null) then
    raise exception 'Each payment needs an id' using errcode = '22023';
  end if;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x) then
    raise exception 'A payment was sent twice' using errcode = '22023';
  end if;

  -- Idempotency: the same payments sent again (e.g. after a dropped
  -- connection) return the saved order without charging twice.
  select count(*) into v_existing from public.payments where id = any (v_ids);
  if v_existing > 0 then
    if v_existing = cardinality(v_ids)
      and not exists (select 1 from public.payments where id = any (v_ids) and order_id <> p_order_id) then
      return public.order_summary(p_order_id);
    end if;
    raise exception 'These payments don''t match what was saved' using errcode = '23505';
  end if;

  if v_order.status = 'voided' then
    raise exception 'This order was voided' using errcode = '22023';
  end if;
  if v_order.paid_at is not null then
    raise exception 'This order is already paid' using errcode = '22023';
  end if;
  if cardinality(v_ids) = 0 and v_order.total > 0 then
    raise exception 'Add a payment' using errcode = '22023';
  end if;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    begin
      select * into v_method from public.payment_methods
      where id = nullif(v_payment ->> 'payment_method_id', '')::uuid;
      v_amount := (v_payment ->> 'amount')::integer;
      v_tendered := nullif(v_payment ->> 'tendered', '')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A payment wasn''t sent correctly' using errcode = '22023';
    end;
    if v_method.id is null or not v_method.is_enabled then
      raise exception 'That payment method isn''t available' using errcode = '22023';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Payment amounts must be more than zero' using errcode = '22023';
    end if;

    v_reference := nullif(btrim(v_payment ->> 'reference'), '');
    if v_method.requires_reference and v_reference is null then
      raise exception '% needs a reference number', v_method.name using errcode = '22023';
    end if;

    if v_method.type = 'cash' then
      v_tendered := coalesce(v_tendered, v_amount);
      if v_tendered < v_amount then
        raise exception 'Cash handed over can''t be less than the amount paid' using errcode = '22023';
      end if;
    else
      if v_tendered is not null and v_tendered <> v_amount then
        raise exception 'Only cash can be over-tendered' using errcode = '22023';
      end if;
      v_tendered := null;
    end if;

    v_sum := v_sum + v_amount;
    insert into public.payments (
      id, order_id, branch_id, shift_id, payment_method_id, method, method_name, amount, tendered,
      change_given, reference, staff_id, device_id, pos_session_id, client_created_at
    )
    values (
      (v_payment ->> 'id')::uuid, v_order.id, v_order.branch_id, v_order.shift_id, v_method.id, v_method.type,
      v_method.name, v_amount, v_tendered,
      case when v_tendered is null then null else v_tendered - v_amount end,
      v_reference, v_session.staff_id, v_session.device_id, v_session.id,
      case when v_payment ? 'client_created_at' then (v_payment ->> 'client_created_at')::timestamptz end
    );
    v_summary := v_summary || jsonb_build_object('method', v_method.name, 'amount', v_amount);
  end loop;

  if v_sum <> v_order.total then
    raise exception 'The payments don''t add up to the order total' using errcode = '22023';
  end if;

  update public.orders
  set paid_at = now(),
      status = case when status = 'open' then 'paid'::public.order_status else status end
  where id = v_order.id;
  perform public.send_order_lines_to_kitchen(v_order.id);

  perform public.write_audit(
    p_action => 'order.paid',
    p_entity => 'orders',
    p_entity_id => v_order.id::text,
    p_after => jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total, 'payments', v_summary),
    p_branch_id => v_order.branch_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );

  return public.order_summary(v_order.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- send_to_kitchen: dine-in orders can be cooked before they're paid when the
-- branch's orders.pay_later_dine_in setting is on.
-- ---------------------------------------------------------------------------

create function public.send_to_kitchen(p_session_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_order public.orders;
begin
  if not public.staff_has_permission(v_session.staff_id, 'order.create') then
    raise exception 'You are not allowed to take orders' using errcode = '42501';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.branch_id <> v_session.branch_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.sent_to_kitchen_at is not null then
    return public.order_summary(p_order_id);
  end if;
  if v_order.order_type <> 'dine_in'
    or not coalesce((public.branch_setting(v_order.branch_id, 'orders.pay_later_dine_in') #>> '{}')::boolean, false) then
    raise exception 'Only dine-in orders can go to the kitchen before payment, and only when pay-later is switched on'
      using errcode = '22023';
  end if;
  if v_order.status <> 'open' then
    raise exception 'This order can''t be sent to the kitchen' using errcode = '22023';
  end if;

  update public.orders set status = 'in_kitchen' where id = p_order_id;
  perform public.send_order_lines_to_kitchen(p_order_id);

  perform public.write_audit(
    p_action => 'order.sent_to_kitchen',
    p_entity => 'orders',
    p_entity_id => p_order_id::text,
    p_after => jsonb_build_object('order_number', v_order.order_number, 'paid', false),
    p_branch_id => v_order.branch_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return public.order_summary(p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_menu now includes the enabled payment methods (for the till and its
-- offline cache). Same document as before plus "payment_methods".
-- ---------------------------------------------------------------------------

create or replace function public.get_menu(p_branch_id uuid)
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
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pm.id,
        'type', pm.type,
        'name', pm.name,
        'requires_reference', pm.requires_reference
      ) order by pm.sort_order, pm.name)
      from public.payment_methods pm where pm.is_enabled
    ), '[]'::jsonb)
  ) into v_menu;

  return v_menu;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.branch_setting(uuid, text),
  public.send_order_lines_to_kitchen(uuid),
  public.record_payments(uuid, uuid, jsonb),
  public.send_to_kitchen(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.record_payments(uuid, uuid, jsonb),
  public.send_to_kitchen(uuid, uuid)
to authenticated;
