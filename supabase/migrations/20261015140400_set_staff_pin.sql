-- Phase 1: set_staff_pin(p_staff_id, p_pin)
--
-- Admins can set any active staff member's PIN. Staff with
-- staff.manage_cashiers (managers) can set PINs for cashiers in their own
-- branch. The PIN must be 4-6 digits and unique among active staff who could
-- use the same till: the same branch, plus admins (who have no branch and can
-- sign in anywhere).
--
-- The hash uses bcrypt cost 8. A 4-6 digit PIN can't resist offline cracking
-- at any cost, so protection comes from never exposing hashes. A lower cost
-- keeps PIN sign-in fast: the till checks the PIN against every active staff
-- member in the branch, on the server and later offline on the tablet.

create function public.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_staff_id();
  v_actor_branch_id uuid := public.current_branch_id();
  v_target public.staff;
begin
  if v_actor_id is null then
    raise exception 'Sign in as an admin or manager to set PINs'
      using errcode = '42501';
  end if;

  select * into v_target
  from public.staff
  where id = p_staff_id
  for update;

  if not found then
    raise exception 'Staff member not found'
      using errcode = 'P0002';
  end if;

  if not (
    public.staff_has_permission(v_actor_id, 'staff.manage_all')
    or (
      public.staff_has_permission(v_actor_id, 'staff.manage_cashiers')
      and v_target.role = 'cashier'
      and v_target.branch_id = v_actor_branch_id
    )
  ) then
    raise exception 'You are not allowed to set this staff member''s PIN'
      using errcode = '42501';
  end if;

  if not v_target.is_active then
    raise exception 'Cannot set a PIN for an inactive staff member'
      using errcode = '22023';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.staff s
    where s.id <> v_target.id
      and s.is_active
      and s.pin_hash is not null
      and (
        v_target.branch_id is null
        or s.branch_id is null
        or s.branch_id = v_target.branch_id
      )
      and s.pin_hash = extensions.crypt(p_pin, s.pin_hash)
  ) then
    raise exception 'This PIN is already used by someone else in this branch. Choose a different PIN.'
      using errcode = '23505';
  end if;

  update public.staff
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8))
  where id = v_target.id;

  -- The row trigger skips PIN-only changes, so log this explicitly. Never log
  -- the PIN or its hash.
  perform public.write_audit(
    p_action => 'staff.pin_set',
    p_entity => 'staff',
    p_entity_id => v_target.id::text,
    p_branch_id => v_target.branch_id
  );
end;
$$;

revoke execute on function public.set_staff_pin(uuid, text) from public, anon;
grant execute on function public.set_staff_pin(uuid, text) to authenticated;
