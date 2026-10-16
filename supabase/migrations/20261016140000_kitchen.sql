-- Phase 10: kitchen display and pickup screen.
--
-- Kitchen screens (KDS devices) bump what they've made. A meal is ready when
-- all its parts are; an order is ready (ready_at) when nothing is left to
-- make. The till marks orders collected (collected_at). With
-- sent_to_kitchen_at these give speed-of-service times.

-- When a kitchen screen cleared the item: made, or a void seen. Items with
-- no bumped_at still show on the screens.
alter table public.order_items add column bumped_at timestamptz;
create index order_items_kitchen_idx on public.order_items (branch_id, bumped_at) where bumped_at is null;
create index orders_kitchen_idx on public.orders (branch_id, sent_to_kitchen_at desc)
  where sent_to_kitchen_at is not null and collected_at is null;

insert into public.settings (branch_id, key, value) values
  (null, 'pickup.ready_minutes', '10'),
  (null, 'pickup.chime', 'true'),
  (null, 'kds.sound', 'true');

-- The kitchen screen calling, or an error.
create function public.require_kitchen_device()
returns public.devices
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
begin
  select * into v_device from public.devices
  where id = public.current_device_id() and is_active and type = 'kds';
  if v_device.id is null then
    raise exception 'Only a kitchen screen can do this' using errcode = '42501';
  end if;
  return v_device;
end;
$$;

-- Orders whose kitchen items are all done become ready.
create function public.refresh_kitchen_status(p_order_ids uuid[])
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  -- Meals: done when every part is.
  update public.order_items p
  set status = 'ready', bumped_at = coalesce(p.bumped_at, now())
  where p.order_id = any (p_order_ids)
    and p.parent_item_id is null
    and p.status in ('pending', 'sent')
    and exists (select 1 from public.order_items c where c.parent_item_id = p.id)
    and not exists (
      select 1 from public.order_items c where c.parent_item_id = p.id and c.status in ('pending', 'sent')
    );
  update public.orders o
  set status = 'ready', ready_at = coalesce(o.ready_at, now())
  where o.id = any (p_order_ids)
    and o.status in ('paid', 'in_kitchen')
    and not exists (
      select 1 from public.order_items i where i.order_id = o.id and i.status in ('pending', 'sent')
    );
$$;

-- A kitchen screen marks items done (or acknowledges voided ones). Safe to
-- repeat. Returns the orders that became ready.
create function public.bump_items(p_item_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.devices := public.require_kitchen_device();
  v_orders uuid[];
begin
  if coalesce(cardinality(p_item_ids), 0) = 0 then
    return '[]'::jsonb;
  end if;
  if exists (
    select 1 from unnest(p_item_ids) as x(id)
    where not exists (
      select 1 from public.order_items i
      join public.orders o on o.id = i.order_id
      where i.id = x.id and i.branch_id = v_device.branch_id and o.sent_to_kitchen_at is not null
    )
  ) then
    raise exception 'Those items aren''t in this kitchen' using errcode = 'P0002';
  end if;

  update public.order_items
  set bumped_at = coalesce(bumped_at, now()),
      status = case when status in ('pending', 'sent') then 'ready'::public.order_item_status else status end
  where id = any (p_item_ids);

  select coalesce(array_agg(distinct order_id), '{}') into v_orders
  from public.order_items where id = any (p_item_ids);
  perform public.refresh_kitchen_status(v_orders);

  return coalesce((
    select jsonb_agg(o.id) from public.orders o where o.id = any (v_orders) and o.status = 'ready'
  ), '[]'::jsonb);
end;
$$;

-- Puts bumped items back on the kitchen screens (bumped by mistake).
create function public.recall_items(p_item_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.devices := public.require_kitchen_device();
  v_orders uuid[];
begin
  if coalesce(cardinality(p_item_ids), 0) = 0 then
    return;
  end if;
  if exists (
    select 1 from unnest(p_item_ids) as x(id)
    where not exists (
      select 1 from public.order_items i where i.id = x.id and i.branch_id = v_device.branch_id
    )
  ) then
    raise exception 'Those items aren''t in this kitchen' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct order_id), '{}') into v_orders
  from public.order_items where id = any (p_item_ids);
  if exists (select 1 from public.orders where id = any (v_orders) and collected_at is not null) then
    raise exception 'That order has been collected' using errcode = '22023';
  end if;

  update public.order_items
  set bumped_at = null,
      status = case when status = 'ready' then 'sent'::public.order_item_status else status end
  where id = any (p_item_ids)
     or id in (select parent_item_id from public.order_items where id = any (p_item_ids));
  update public.orders
  set status = case when paid_at is null then 'in_kitchen'::public.order_status else 'paid'::public.order_status end,
      ready_at = null
  where id = any (v_orders) and status = 'ready';
end;
$$;

-- The customer has their food: the order leaves the screens. Safe to repeat.
create function public.mark_order_collected(p_session_id uuid, p_order_id uuid)
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
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.branch_id <> v_session.branch_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.collected_at is not null then
    return public.order_summary(p_order_id);
  end if;
  if v_order.sent_to_kitchen_at is null then
    raise exception 'This order hasn''t gone to the kitchen' using errcode = '22023';
  end if;
  if v_order.paid_at is null then
    raise exception 'Take payment before handing the order over' using errcode = '22023';
  end if;

  update public.order_items
  set bumped_at = coalesce(bumped_at, now()),
      status = case when status in ('pending', 'sent') then 'ready'::public.order_item_status else status end
  where order_id = p_order_id;
  update public.orders
  set collected_at = now(),
      ready_at = coalesce(ready_at, now()),
      status = case when status in ('paid', 'in_kitchen', 'ready') then 'collected'::public.order_status else status end
  where id = p_order_id;
  return public.order_summary(p_order_id);
end;
$$;

revoke execute on function
  public.require_kitchen_device(),
  public.refresh_kitchen_status(uuid[]),
  public.bump_items(uuid[]),
  public.recall_items(uuid[]),
  public.mark_order_collected(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.bump_items(uuid[]),
  public.recall_items(uuid[]),
  public.mark_order_collected(uuid, uuid)
to authenticated;
