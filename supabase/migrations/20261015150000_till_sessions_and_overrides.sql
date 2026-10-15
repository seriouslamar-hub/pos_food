-- Phase 2: till PIN sign-in, PIN lockout and manager overrides.
--
-- start_pos_session and verify_override return { ok: false, error } instead of
-- raising on a wrong PIN. Raising would roll back the pin_attempts row and the
-- audit entry, and both must be kept for lockout and the audit trail.
--
-- App error codes (SQLSTATE) raised by these functions:
--   PS401  the till session has ended; go back to the lock screen
--   PS403  a manager approval is missing, expired or already used

-- Default auto-lock for tills. Branches can override it in settings.
insert into public.settings (branch_id, key, value)
values (null, 'till.auto_lock_minutes', '5')
on conflict on constraint settings_branch_key_unique do nothing;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable through the API)
-- ---------------------------------------------------------------------------

-- Permission keys for a staff member, as the till needs them. Any migration
-- that adds a permission key must also grant it to the admin role.
create function public.staff_permissions(p_staff_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}')
  from public.staff s
  join public.role_permissions rp on rp.role = s.role
  where s.id = p_staff_id
    and s.is_active;
$$;

-- Seconds until the device may try a PIN again; 0 when not locked out.
-- Uses clock_timestamp() rather than now(), which is fixed for a whole
-- transaction and would make attempts in one transaction look simultaneous.
-- 5 failed attempts within 5 minutes (since the last success) lock the
-- device for 1 minute after the latest failure.
create function public.pin_lockout_seconds(p_device_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with failures as (
    select pa.attempted_at
    from public.pin_attempts pa
    where pa.device_id = p_device_id
      and not pa.success
      and pa.attempted_at > clock_timestamp() - interval '5 minutes'
      and pa.attempted_at > coalesce(
        (select max(s.attempted_at) from public.pin_attempts s
         where s.device_id = p_device_id and s.success),
        '-infinity'
      )
  )
  select case
    when count(*) >= 5 then
      greatest(0, ceil(extract(epoch from (max(attempted_at) + interval '1 minute' - clock_timestamp())))::integer)
    else 0
  end
  from failures;
$$;

-- The active staff member with this PIN who can use a till in the branch:
-- the branch's own staff, plus admins (who have no branch).
create function public.find_staff_by_pin(p_branch_id uuid, p_pin text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff s
  where p_pin ~ '^[0-9]{4,6}$'
    and s.is_active
    and s.pin_hash is not null
    and (s.branch_id = p_branch_id or (s.branch_id is null and s.role = 'admin'))
    and s.pin_hash = extensions.crypt(p_pin, s.pin_hash)
  limit 1;
$$;

-- The open till session with this id on the calling device, for a staff
-- member who is still active. Every till RPC starts with this.
create function public.require_pos_session(p_session_id uuid)
returns public.pos_sessions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions;
begin
  select ps.* into v_session
  from public.pos_sessions ps
  join public.staff s on s.id = ps.staff_id and s.is_active
  where ps.id = p_session_id
    and ps.device_id = public.current_device_id()
    and ps.ended_at is null;

  if v_session.id is null then
    raise exception 'Your till session has ended. Sign in with your PIN again.'
      using errcode = 'PS401';
  end if;

  return v_session;
end;
$$;

-- Uses a manager approval for one protected action. Later RPCs (voids,
-- refunds, discounts, no-sale, price overrides) call this with their
-- p_override_id. Returns the approving staff member's id.
create function public.consume_override(p_override_id uuid, p_branch_id uuid, p_permission text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_approver_id uuid;
begin
  update public.override_approvals
  set used_at = now()
  where id = p_override_id
    and branch_id = p_branch_id
    and permission = p_permission
    and used_at is null
    and expires_at > now()
  returning approved_by_staff_id into v_approver_id;

  if v_approver_id is null then
    raise exception 'Manager approval is missing, expired or already used. Ask for approval again.'
      using errcode = 'PS403';
  end if;

  return v_approver_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_pos_session: PIN sign-in on a till device
-- ---------------------------------------------------------------------------

create function public.start_pos_session(p_pin text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.devices := public.current_device();
  v_wait integer;
  v_staff_id uuid;
  v_staff public.staff;
  v_session_id uuid;
begin
  if v_device.id is null or v_device.type <> 'till' then
    raise exception 'Only a till device can start a till session'
      using errcode = '42501';
  end if;

  v_wait := public.pin_lockout_seconds(v_device.id);
  if v_wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'locked_out', 'retry_after_seconds', v_wait);
  end if;

  v_staff_id := public.find_staff_by_pin(v_device.branch_id, p_pin);

  insert into public.pin_attempts (device_id, attempted_at, success)
  values (v_device.id, clock_timestamp(), v_staff_id is not null);

  update public.devices set last_seen_at = now() where id = v_device.id;

  if v_staff_id is null then
    v_wait := public.pin_lockout_seconds(v_device.id);
    return jsonb_build_object(
      'ok', false,
      'error', case when v_wait > 0 then 'locked_out' else 'invalid_pin' end,
      'retry_after_seconds', v_wait
    );
  end if;

  select * into v_staff from public.staff where id = v_staff_id;

  -- One open session per device: signing in ends the previous one.
  update public.pos_sessions
  set ended_at = now()
  where device_id = v_device.id
    and ended_at is null;

  insert into public.pos_sessions (branch_id, device_id, staff_id)
  values (v_device.branch_id, v_device.id, v_staff.id)
  returning id into v_session_id;

  perform public.write_audit(
    p_action => 'pos_session.start',
    p_entity => 'pos_sessions',
    p_entity_id => v_session_id::text,
    p_branch_id => v_device.branch_id,
    p_actor_staff_id => v_staff.id,
    p_device_id => v_device.id
  );

  return jsonb_build_object(
    'ok', true,
    'session_id', v_session_id,
    'staff', jsonb_build_object(
      'id', v_staff.id,
      'full_name', v_staff.full_name,
      'role', v_staff.role,
      'discount_limit_bps', v_staff.discount_limit_bps
    ),
    'permissions', to_jsonb(public.staff_permissions(v_staff.id))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- end_pos_session: lock or switch user. Safe to call more than once.
-- ---------------------------------------------------------------------------

create function public.end_pos_session(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device_id uuid := public.current_device_id();
begin
  if v_device_id is null then
    raise exception 'Only a device can end a till session'
      using errcode = '42501';
  end if;

  update public.pos_sessions
  set ended_at = now()
  where id = p_session_id
    and device_id = v_device_id
    and ended_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_override: a manager (or anyone with the permission) approves one
-- protected action on the till with their PIN. Every attempt is audited.
-- ---------------------------------------------------------------------------

create function public.verify_override(
  p_session_id uuid,
  p_pin text,
  p_permission text,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_wait integer;
  v_approver public.staff;
  v_approver_id uuid;
  v_override public.override_approvals;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_permission is null
    or not exists (select 1 from public.role_permissions where permission = p_permission) then
    raise exception 'Unknown permission "%"', p_permission
      using errcode = '22023';
  end if;

  v_wait := public.pin_lockout_seconds(v_session.device_id);
  if v_wait > 0 then
    perform public.write_audit(
      p_action => 'override.denied', p_entity => 'override_approvals', p_entity_id => null,
      p_after => jsonb_build_object('permission', p_permission, 'result', 'locked_out'),
      p_reason => v_reason, p_branch_id => v_session.branch_id,
      p_actor_staff_id => v_session.staff_id, p_device_id => v_session.device_id
    );
    return jsonb_build_object('ok', false, 'error', 'locked_out', 'retry_after_seconds', v_wait);
  end if;

  v_approver_id := public.find_staff_by_pin(v_session.branch_id, p_pin);

  insert into public.pin_attempts (device_id, attempted_at, success)
  values (v_session.device_id, clock_timestamp(), v_approver_id is not null);

  if v_approver_id is null then
    perform public.write_audit(
      p_action => 'override.denied', p_entity => 'override_approvals', p_entity_id => null,
      p_after => jsonb_build_object('permission', p_permission, 'result', 'invalid_pin'),
      p_reason => v_reason, p_branch_id => v_session.branch_id,
      p_actor_staff_id => v_session.staff_id, p_device_id => v_session.device_id
    );
    v_wait := public.pin_lockout_seconds(v_session.device_id);
    return jsonb_build_object(
      'ok', false,
      'error', case when v_wait > 0 then 'locked_out' else 'invalid_pin' end,
      'retry_after_seconds', v_wait
    );
  end if;

  select * into v_approver from public.staff where id = v_approver_id;

  if not public.staff_has_permission(v_approver.id, p_permission) then
    perform public.write_audit(
      p_action => 'override.denied', p_entity => 'override_approvals', p_entity_id => null,
      p_after => jsonb_build_object('permission', p_permission, 'result', 'not_permitted'),
      p_reason => v_reason, p_branch_id => v_session.branch_id,
      p_approver_staff_id => v_approver.id,
      p_actor_staff_id => v_session.staff_id, p_device_id => v_session.device_id
    );
    return jsonb_build_object('ok', false, 'error', 'not_permitted');
  end if;

  insert into public.override_approvals (
    branch_id, device_id, requested_by_staff_id, approved_by_staff_id, permission, expires_at
  )
  values (
    v_session.branch_id, v_session.device_id, v_session.staff_id, v_approver.id, p_permission,
    now() + interval '2 minutes'
  )
  returning * into v_override;

  perform public.write_audit(
    p_action => 'override.approved', p_entity => 'override_approvals', p_entity_id => v_override.id::text,
    p_after => jsonb_build_object('permission', p_permission, 'expires_at', v_override.expires_at),
    p_reason => v_reason, p_branch_id => v_session.branch_id,
    p_approver_staff_id => v_approver.id,
    p_actor_staff_id => v_session.staff_id, p_device_id => v_session.device_id
  );

  return jsonb_build_object(
    'ok', true,
    'override_id', v_override.id,
    'approver', jsonb_build_object('id', v_approver.id, 'full_name', v_approver.full_name),
    'expires_at', v_override.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: only the three till RPCs are callable through the API.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.staff_permissions(uuid),
  public.pin_lockout_seconds(uuid),
  public.find_staff_by_pin(uuid, text),
  public.require_pos_session(uuid),
  public.consume_override(uuid, uuid, text),
  public.start_pos_session(text),
  public.end_pos_session(uuid),
  public.verify_override(uuid, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.start_pos_session(text),
  public.end_pos_session(uuid),
  public.verify_override(uuid, text, text, text)
to authenticated;
