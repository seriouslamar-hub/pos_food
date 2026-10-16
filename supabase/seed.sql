-- Local test data only. `supabase db reset` loads this after the migrations;
-- `supabase db push` never runs it, so it never reaches production.
--
-- Test logins (password for all: password123)
--   admin@example.com          Admin (all branches)        PIN 9000
--   manager@example.com        Manager, Main branch        PIN 9999
--   device-t1@example.com      Till device T1, Main branch
--   device-kds1@example.com    KDS device K1, Main branch
-- Cashiers have no login; they use a PIN on the till:
--   Ama Cashier                PIN 1111
--   Kofi Cashier               PIN 2222

-- ---------------------------------------------------------------------------
-- Branch
-- ---------------------------------------------------------------------------

insert into public.branches (id, name, address, phone, timezone, currency_code, receipt_header, receipt_footer)
values (
  '10000000-0000-4000-8000-000000000001',
  'Main branch',
  '1 High Street',
  '+10000000000',
  'UTC',
  'USD',
  'Main branch',
  'Thank you for your order!'
);

-- ---------------------------------------------------------------------------
-- Auth users (staff with email logins, and device accounts)
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
  '', '', '', '', '', '', '', ''
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@example.com'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'manager@example.com'),
  ('a0000000-0000-4000-8000-000000000011'::uuid, 'device-t1@example.com'),
  ('a0000000-0000-4000-8000-000000000012'::uuid, 'device-kds1@example.com'),
  ('a0000000-0000-4000-8000-000000000013'::uuid, 'device-pickup1@example.com')
) as u (id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.id in (
  'a0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000002',
  'a0000000-0000-4000-8000-000000000011',
  'a0000000-0000-4000-8000-000000000012',
  'a0000000-0000-4000-8000-000000000013'
);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------

insert into public.staff (id, auth_user_id, branch_id, full_name, email, role, pin_hash, discount_limit_bps)
values
  ('20000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', null,
   'Ada Admin', 'admin@example.com', 'admin', extensions.crypt('9000', extensions.gen_salt('bf', 8)), 10000),
  ('20000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'Max Manager', 'manager@example.com', 'manager', extensions.crypt('9999', extensions.gen_salt('bf', 8)), 5000),
  ('20000000-0000-4000-8000-000000000003', null, '10000000-0000-4000-8000-000000000001',
   'Ama Cashier', null, 'cashier', extensions.crypt('1111', extensions.gen_salt('bf', 8)), 1000),
  ('20000000-0000-4000-8000-000000000004', null, '10000000-0000-4000-8000-000000000001',
   'Kofi Cashier', null, 'cashier', extensions.crypt('2222', extensions.gen_salt('bf', 8)), 1000);

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------

insert into public.devices (id, branch_id, auth_user_id, name, type, code, station)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000011', 'Front counter till', 'till', 'T1', null),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000012', 'Kitchen display', 'kds', 'K1', null),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000013', 'Pickup board', 'pickup', 'P1', null);

-- ---------------------------------------------------------------------------
-- Taxes (sample; real rates are set by an admin)
-- ---------------------------------------------------------------------------

insert into public.taxes (name, rate_bps, is_inclusive, tax_category, sort_order)
values ('Sales tax', 1000, false, 'standard', 10);

-- ---------------------------------------------------------------------------
-- Sample menu, loaded as the seeded admin so permission checks and the audit
-- log behave as they do for a real admin.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}', false);
select public.load_sample_menu();
select set_config('request.jwt.claims', '', false);
