# Fast-Food POS System: Build Plan

A step-by-step plan for building a multi-branch fast-food point-of-sale system with **Admin**, **Manager** and **Cashier** roles, using **Next.js, Supabase, Git/GitHub and Vercel**.

Each phase has:
- **Goal**: what the phase delivers
- **Prompt**: copy it into your AI coding assistant
- **Done when**: tick every box before moving on

---

## How to use this plan

1. Work through the phases in order. Each one builds on the one before.
2. Start every coding session with the **Session starter prompt** below, then paste the prompt for the phase you're on.
3. Don't start the next phase until every box in **Done when** is ticked.
4. Work on a Git branch per phase. Merge to `main` when the phase is done. Vercel deploys the app, and the GitHub Action applies the database migrations.
5. Tick the boxes in this file as you go so it doubles as your progress tracker.

### Session starter prompt

Paste this at the start of every session, with `plan.md` attached or in the repo:

```text
I'm building a fast-food POS system. The full plan is in plan.md in this repo.
Read the sections "Project context", "Rules for every phase", "Roles and permissions"
and "Data model" first, then the phase I give you. Follow the rules strictly.

We are on Phase [NUMBER]: [NAME].
Before writing code, list the files and migrations you plan to create or change,
then build it step by step. After each step, run the type-check, linter and tests.
When you finish, go through the phase's "Done when" checklist and tell me which
items pass and which still need me (for example, hardware or Vercel settings).
```

---

## Project context

**Product:** A POS system for a fast-food business with one or more branches. It covers counter ordering, payments, receipts, kitchen display, pickup screen, cash and shift control, inventory, reports, promotions and an offline mode so tills keep selling when the internet drops.

**Users and devices**

| Who | Uses | Signs in with |
|---|---|---|
| Admin (owner/head office) | Back office on a laptop | Email + password |
| Manager (one branch) | Back office, plus overrides at the till | Email + password; PIN at the till |
| Cashier | Till (tablet or touch PC) | 4–6 digit PIN on a signed-in till device |
| Kitchen staff | Kitchen display screen | Device account (no personal login) |
| Customers | Pickup screen (TV) | Device account |

**Tech stack**

| Layer | Choice |
|---|---|
| App framework | Next.js (App Router) + TypeScript (strict) |
| UI | Tailwind CSS + shadcn/ui |
| Database, auth, realtime, file storage | Supabase (Postgres, Auth, Row Level Security, Realtime, Storage, Edge Functions) |
| Supabase libraries | `@supabase/supabase-js`, `@supabase/ssr` |
| Offline | PWA with Serwist (service worker) + Dexie.js (IndexedDB) |
| Charts | Recharts |
| Tests | Vitest (unit), Playwright (end-to-end), pgTAP via `supabase test db` (database and RLS) |
| Version control | Git + GitHub |
| Hosting | Vercel (app), Supabase (database) |
| Database changes | Supabase CLI migrations, applied by GitHub Actions on push to `main` |

**Folder structure**

```text
/app
  /(auth)/login              back-office login
  /(backoffice)/admin/...    admin pages
  /(backoffice)/manager/...  manager pages
  /device/setup              register a till/KDS/pickup device
  /till                      cashier POS screens
  /kds                       kitchen display
  /pickup                    customer pickup board
/components                  shared UI (keypad, modals, receipt, etc.)
/lib
  /supabase                  client.ts, server.ts
  money.ts                   formatMoney, parseMoney
  pricing.ts                 cart preview maths (server is the source of truth)
  permissions.ts             permission constants + can() helper
  printing.ts                printer drivers (browser print now, others later)
  /offline                   Dexie database, outbox, sync worker
  /payments                  payment provider interface
/supabase
  /migrations                every database change, in order
  /tests                     pgTAP tests for RLS and functions
  /functions                 Edge Functions
  seed.sql                   local test data only
/tests                       Playwright end-to-end tests
.github/workflows            CI + database migrations
```

---

## Rules for every phase

1. **Money is stored as integers in minor units** (e.g. `1250` = 12.50). Never use floats for money. Format only in the UI through `formatMoney()`.
2. **Row Level Security is on for every table.** Default deny. No table is readable or writable without an explicit policy.
3. **Every business row carries `branch_id`.** Managers and cashiers can only reach their own branch's data.
4. **Sensitive writes go through Postgres functions (RPC),** not direct inserts from the browser: orders, payments, voids, refunds, discounts, cash movements, shift close, price changes, staff PINs. Each function checks permissions itself.
5. **Never trust the client for prices or totals.** The server recalculates everything from the menu.
6. **All IDs are UUIDs.** Orders, order lines, payments and cash movements get their ID on the device, and every write RPC is **idempotent** on that ID, so re-sending after a network failure never creates duplicates.
7. **Every sensitive action writes to `audit_log`,** recording who did it, who approved it, and before/after values. The audit log is insert-only.
8. **Database changes only through migration files** in `supabase/migrations/`. Never change the production database by hand. Write migrations so the old app version still works while the new one deploys (add columns first, use them later, remove last).
9. **The `service_role` key never goes in browser code** or any `NEXT_PUBLIC_*` variable. Use it only in server routes or Edge Functions.
10. **Order lines store a snapshot** of item name, price and modifiers, so editing the menu never changes old orders or receipts.
11. **Times are stored as `timestamptz` (UTC)** and shown in the branch's timezone. "Business day" boundaries use the branch timezone.
12. **Test what protects money:** every RPC that moves money and every RLS policy gets a test.
13. **Till UI is touch-first:** buttons at least 48px, works on a 10" tablet in landscape, no hover-only actions, readable at arm's length.
14. **Small commits, clear messages,** one phase per branch. CI must pass before merging.

---

## Roles and permissions

### What each role does

**Admin (owner/head office):** everything a manager can do, across all branches, plus system setup (branches, taxes, payment methods, devices), all user management, master menu and prices, promotions, inventory setup (ingredients, recipes, suppliers), all-branch reports, audit log and integrations.

**Manager (one branch):** opens and closes the business day, opens cashier shifts and reconciles cash, approves voids/refunds/discounts/no-sale with a PIN, manages cashiers in their branch, marks items out of stock, runs inventory (deliveries, counts, waste, purchase orders), monitors the kitchen, and views branch reports.

**Cashier:** signs in with a PIN, opens a shift with a counted float, takes orders with combos and modifiers, applies promos and allowed discounts, takes payments (cash, card, mobile money, split), prints receipts, sends orders to the kitchen, voids their own unsent items, does a blind cash count at shift end, and sees only their own shift summary.

### Permission matrix

| Action | Admin | Manager | Cashier |
|---|---|---|---|
| Take orders and payments | Yes | Yes | Yes |
| Void before sent to kitchen | Yes | Yes | Own orders only |
| Void after sent to kitchen | Yes | Yes | Manager PIN |
| Refund | Yes | Yes | Manager PIN |
| Discount within limit | Yes | Yes | Yes |
| Discount above limit | Yes | Yes | Manager PIN |
| Open drawer without sale | Yes | Yes | Manager PIN |
| Price override | Yes | Yes | Manager PIN |
| Mark item out of stock | Yes | Yes | No |
| Change menu and prices | Yes | No | No |
| Create cashiers | Yes | Own branch | No |
| Create managers and admins | Yes | No | No |
| Open/close business day | Yes | Yes | No |
| Close shift and reconcile cash | Yes | Yes | Own blind count only |
| Inventory | Yes | Own branch | No |
| Reports | All branches | Own branch | Own shift only |
| Audit log | All | Own branch | No |
| System settings, taxes, devices | Yes | No | No |

### Permission keys (used in code and the `role_permissions` table)

```text
order.create            order.void_unsent       order.void_sent
order.refund            discount.apply          discount.override
price.override          drawer.no_sale          menu.edit
menu.availability       staff.manage_cashiers   staff.manage_all
shift.open              shift.close_own         shift.reconcile
day.open_close          inventory.manage        promo.manage
reports.own_shift       reports.branch          reports.all
audit.view_branch       audit.view_all          settings.manage
devices.manage
```

Roles map to permissions in a database table, not in code, so the admin can later give a senior cashier one extra permission without a code change. "Manager PIN" in the matrix means the cashier doesn't have the permission, so the till asks for an override from someone who does.

---

## Data model

Summary by module. Column details are in each phase's prompt.

| Module | Tables |
|---|---|
| Foundation | `branches`, `staff`, `role_permissions`, `devices`, `pos_sessions`, `pin_attempts`, `override_approvals`, `settings`, `audit_log` |
| Setup | `taxes`, `payment_methods` |
| Menu | `categories`, `menu_items`, `modifier_groups`, `modifiers`, `item_modifier_groups`, `combo_slots`, `combo_slot_options`, `branch_menu_items`, `kds_stations` |
| Orders | `orders`, `order_items`, `payments`, `refunds` |
| Cash | `business_days`, `shifts`, `cash_movements` |
| Inventory | `ingredients`, `recipes`, `branch_stock`, `stock_movements`, `suppliers`, `purchase_orders`, `purchase_order_lines`, `stock_counts`, `stock_count_lines` |
| Marketing | `promotions`, `promotion_redemptions`, `customers`, `loyalty_transactions` |

**Key RPC functions** (all `security definer`, with `search_path` set, permission-checked, idempotent where they write):

`start_pos_session`, `end_pos_session`, `verify_override`, `set_staff_pin`, `get_menu`, `submit_order`, `record_payments`, `void_order_items`, `refund_order`, `open_business_day`, `close_business_day`, `open_shift`, `record_cash_movement`, `close_shift`, `review_shift`, `bump_items`, `mark_order_collected`, `receive_purchase_order`, `record_waste`, `submit_stock_count`, plus `report_*` functions.

**Order status flow:** `open` → `paid` → `in_kitchen` → `ready` → `collected`, with `voided` and `refunded` / `partially_refunded` as exits.

---

## Phase 0: Project setup

**Goal:** A working repo that runs locally, deploys to Vercel, and applies database migrations automatically.

**Prompt:**

```text
Set up the project for the POS system described in plan.md.

1. Create a Next.js App Router project with TypeScript strict mode, Tailwind CSS,
   ESLint and Prettier. Add shadcn/ui.
2. Install @supabase/supabase-js and @supabase/ssr. Create lib/supabase/client.ts
   (browser client), lib/supabase/server.ts (server components and route handlers),
   and middleware.ts that refreshes the auth session on each request.
3. Initialise the Supabase CLI (supabase init) so migrations live in
   supabase/migrations, tests in supabase/tests and local data in supabase/seed.sql.
   Local development must work with `supabase start`.
4. Create .env.example with NEXT_PUBLIC_SUPABASE_URL and
   NEXT_PUBLIC_SUPABASE_ANON_KEY (placeholder values only) and
   SUPABASE_SERVICE_ROLE_KEY (server only). Make sure .env*.local is gitignored.
5. Create the folder structure from plan.md with placeholder pages for /login,
   /admin, /manager, /device/setup, /till, /kds and /pickup.
6. Add lib/money.ts with formatMoney(minorUnits, currencyCode, locale) and
   parseMoney(input) that returns integer minor units. Add Vitest unit tests
   covering rounding, negative values and invalid input.
7. Add .github/workflows/db-migrations.yml exactly as in Appendix A of plan.md.
8. Add .github/workflows/ci.yml that runs lint, type-check and unit tests on every
   pull request and on push to main.
9. Write a README covering: running locally, environment variables, how
   migrations are created (supabase migration new <name>) and how they deploy.
```

**Done when:**
- [ ] `npm run dev` shows all placeholder pages
- [ ] `supabase start` runs locally and `supabase db reset` works
- [ ] Repo is on GitHub and imported into Vercel; pushing to `main` deploys
- [ ] Vercel environment variables are set (URL, anon key, service role key as server-only)
- [ ] GitHub secrets are set: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`
- [ ] CI passes on a test pull request
- [ ] Money helper tests pass

---

## Phase 1: Database foundation

**Goal:** Core tables, roles, permissions, audit log and Row Level Security that everything else builds on.

**Prompt:**

```text
Create the foundation migrations for the POS system in plan.md.

Enums:
- staff_role: 'admin', 'manager', 'cashier'
- device_type: 'till', 'kds', 'pickup', 'kiosk'

Tables:
- branches: id, name, address, phone, timezone (IANA name), currency_code,
  receipt_header, receipt_footer, logo_url, is_active, created_at, updated_at.
- staff: id, auth_user_id (nullable, unique, references auth.users), branch_id
  (nullable only for admins), full_name, phone, email, role staff_role,
  pin_hash (nullable), discount_limit_bps int default 0 (basis points,
  1000 = 10%), is_active, created_at, updated_at.
- role_permissions: role staff_role, permission text, primary key (role, permission).
  Seed it with the mapping implied by the permission matrix in plan.md.
- devices: id, branch_id, auth_user_id (unique), name, type device_type,
  code (short code like 'T1', unique per branch, used for offline order numbers),
  station (nullable, for KDS screens), is_active, last_seen_at.
- pos_sessions: id, device_id, staff_id, started_at, ended_at.
- pin_attempts: device_id, attempted_at, success bool (for lockout).
- override_approvals: id, branch_id, device_id, requested_by_staff_id,
  approved_by_staff_id, permission, expires_at, used_at.
- settings: branch_id (nullable = global default), key, value jsonb,
  unique (branch_id, key).
- audit_log: id bigint identity, branch_id, actor_staff_id, approver_staff_id,
  device_id, action, entity, entity_id, before jsonb, after jsonb, reason,
  is_offline bool default false, created_at. Insert-only: no update or delete
  policies, and revoke update/delete from authenticated and anon.

Helper functions (security definer, stable, set search_path = public):
- current_staff(): the staff row linked to auth.uid(), if any
- current_device(): the device row linked to auth.uid(), if any
- current_branch_id(): branch of the current staff or device
- is_admin()
- staff_has_permission(p_staff_id uuid, p_permission text) returns boolean
- can_access_branch(p_branch_id uuid) returns boolean
- write_audit(...) used by all other functions

RLS on every table:
- Admins can read and write everything.
- Managers can read their own branch's rows; write only where plan.md allows.
- Devices can read their own branch, their own device row, settings and
  role_permissions; nothing else yet.
- Cashiers have no direct table access from the back office.
- anon role has no access to anything.

PIN functions:
- set_staff_pin(p_staff_id, p_pin): admin, or manager for cashiers in their branch.
  Validates 4-6 digits, rejects a PIN already used by another active staff member
  in the same branch (compare with crypt against each), stores bcrypt hash using
  pgcrypto (extensions schema). Writes audit.

Seed (supabase/seed.sql, local only): branch "Main branch", 1 admin, 1 manager,
2 cashiers with known test PINs, 1 till device (code T1), 1 KDS device.

Tests (pgTAP in supabase/tests):
- RLS is enabled on every table in public schema
- A manager cannot read staff from another branch
- Nobody can update or delete audit_log rows
- anon cannot read any table
- set_staff_pin rejects duplicate PINs in a branch
```

**Done when:**
- [ ] `supabase db reset` builds everything from empty with no errors
- [ ] `supabase test db` passes
- [ ] Merged to `main` and the GitHub Action applied the migrations to production
- [ ] Supabase dashboard shows RLS enabled on every table

---

## Phase 2: Authentication and roles

**Goal:** Back-office login by role, till devices with fast PIN switching, and the manager override flow.

**Prompt:**

```text
Build authentication and role-based access as described in plan.md.

Back office:
- /login: email + password with Supabase Auth. After login, load the staff row.
  Admins go to /admin, managers to /manager. Cashiers and inactive staff are
  signed out with a clear message.
- middleware.ts protects /admin (admin only) and /manager (manager or admin).
- Sign out, and graceful handling of expired sessions.

Till devices:
- /device/setup: a signed-in admin or manager selects a branch and a device record,
  then the browser signs in as that device's auth user. Store the device id locally.
  Device sign-in persists across restarts.
- /till lock screen: big numeric keypad. RPC start_pos_session(p_pin):
  - the caller must be a till device
  - verifies the PIN against active staff in the device's branch
  - lockout: after 5 failed attempts in 5 minutes, refuse attempts for 1 minute
    (use pin_attempts)
  - ends any open session on that device, creates a pos_sessions row
  - returns staff id, name, role and their permission list
- Auto-lock after N idle minutes (setting 'till.auto_lock_minutes'), and a
  "Switch user" button.

Permissions in the app:
- lib/permissions.ts: permission constants matching plan.md, a can(permission)
  helper and a usePermission hook for the till session.

Manager override:
- components/ManagerOverride.tsx: modal with PIN keypad and a reason field when needed.
- RPC verify_override(p_session_id, p_pin, p_permission): checks the PIN belongs to
  active staff in this branch who has the permission, creates an
  override_approvals row that expires in 2 minutes, returns its id. Logs every
  attempt (success or fail) to audit_log.
- Other RPCs will accept p_override_id and must check it: same branch, same
  permission, not expired, not used. Mark it used.

Tests:
- Playwright: cashier PIN opens the till; wrong PIN shows an error; lockout works;
  manager override approves a protected action; cashier can't open /admin.
- pgTAP: verify_override rejects a cashier PIN and an expired approval.
```

**Done when:**
- [ ] Admin and manager can log in and land on the right pages
- [ ] Cashier cannot reach the back office
- [ ] Till device setup works and survives a browser restart
- [ ] PIN login, switch user, auto-lock and lockout all work
- [ ] Manager override works and every attempt appears in `audit_log`
- [ ] Tests pass

---

## Phase 3: Admin back office

**Goal:** The admin can configure branches, users, devices, taxes, payment methods and permissions.

**Prompt:**

```text
Build the /admin back office with a sidebar layout (shadcn/ui), following plan.md.

Pages:
- Branches: list, create, edit (name, address, phone, timezone, currency code,
  receipt header/footer, logo upload to Supabase Storage bucket 'branding'),
  activate/deactivate.
- Staff: list with filters (branch, role, active). Create and edit staff.
  For admins and managers, create a Supabase Auth user with email and a temporary
  password through a server-only route handler that uses the service role key,
  and link it to the staff row. Cashiers don't need an email. Set or reset PINs via
  set_staff_pin. Deactivate instead of deleting.
- Devices: register till, KDS, pickup and kiosk devices per branch. Creating a device
  creates its auth user (server-only route) and shows the setup credentials once.
  Show last_seen_at so the admin can see which devices are online.
- Taxes: name, rate in basis points, inclusive or exclusive, applies to which tax
  category. Support several taxes on the same item.
- Payment methods: enable or disable cash, card, mobile money and other;
  choose which require a reference number.
- Role permissions: a grid of permissions × roles the admin can tick and untick.
  The admin row is locked on.
- Settings: auto-lock minutes, cashier default discount limit, order number reset
  daily, receipt paper width (58mm or 80mm), kitchen ticket thresholds.

Manager pages (limited):
- /manager/staff: add and deactivate cashiers in their own branch, reset cashier PINs.
  Managers cannot create managers or admins or touch other branches.

Every create, update and deactivate writes to audit_log with before/after values.
Validate all forms on client and server. Show clear success and error messages.
```

**Done when:**
- [ ] Admin can create a branch, a manager, cashiers and devices end to end
- [ ] Manager can manage only cashiers in their own branch
- [ ] Changing role permissions changes what the till allows
- [ ] All changes appear in the audit log

---

## Phase 4: Menu manager

**Goal:** A flexible menu with categories, modifiers, combos, per-branch prices and live availability.

**Prompt:**

```text
Build the menu system from plan.md.

Tables:
- categories: id, name, sort_order, colour, is_active
- menu_items: id, category_id, type ('item' | 'combo'), name, short_name (for
  receipts and kitchen), description, image_url, base_price (minor units),
  tax_category, kds_station, sort_order, is_active
- modifier_groups: id, name, min_select, max_select
- modifiers: id, group_id, name, price_delta (minor units), kds_station (nullable),
  sort_order, is_active
- item_modifier_groups: menu_item_id, modifier_group_id, sort_order
- combo_slots: id, combo_item_id, name (e.g. "Side", "Drink"), sort_order, required
- combo_slot_options: slot_id, menu_item_id, upcharge, is_default
- branch_menu_items: branch_id, menu_item_id, price_override (nullable),
  is_available, unique (branch_id, menu_item_id)
- kds_stations: id, name (e.g. Fryer, Grill, Sides, Drinks, Assembly)

Admin UI (/admin/menu):
- Manage categories, items, modifier groups, modifiers and combos with drag-and-drop
  sorting.
- Upload item images to Supabase Storage bucket 'menu-images'.
- Combo builder: define slots, allowed options, defaults and upcharges
  (e.g. "Upsize drink +5.00").
- Per-branch price overrides.
- A preview of how the item and its modifier sheet look on the till.

Manager UI (/manager/availability):
- Big toggles to mark items and modifiers out of stock for the branch. Changes reach
  every till instantly through Supabase Realtime.

RPC get_menu(p_branch_id): returns the full menu as JSON with effective prices,
availability, modifiers and combo slots, ready for the till to cache.

Seed a sample fast-food menu: chicken pieces, burgers, wraps, sides (fries,
coleslaw, rice), drinks in sizes, a "2-piece meal" combo (side + drink slots,
upsize option) and a family bucket.

Every menu change writes to audit_log. Price changes need menu.edit permission.
```

**Done when:**
- [ ] Admin can build the sample menu through the UI
- [ ] Branch price overrides show the correct effective price in `get_menu`
- [ ] Marking an item out of stock updates other open tills within a few seconds
- [ ] Menu changes appear in the audit log

---

## Phase 5: Till order screen

**Goal:** Cashiers can build orders fast, and the server saves them with correct prices.

**Prompt:**

```text
Build the /till order screen from plan.md for tablets in landscape
(1280×800 and 1024×768).

Layout: category tabs, item grid in the centre, cart on the right.

Features:
- Tapping an item with modifier groups opens a modifier sheet that enforces
  min/max selections. Combos open a step-by-step slot picker (choose side, choose
  drink, upsize).
- Cart: quantity +/−, edit a line, notes per line ("no pepper"), remove line,
  subtotal / discount / tax / total preview from lib/pricing.ts.
- Order type: dine-in, takeaway, delivery (delivery asks for customer phone and
  address).
- Hold an order with a label and recall held orders.
- Out-of-stock items are greyed out and update live via Realtime.
- The order id is a UUID generated on the device when the cart starts; each line
  also gets a UUID.

Tables:
- orders: id (client UUID), branch_id, device_id, staff_id, shift_id (nullable for
  now; Phase 7 makes it required), order_number text, channel ('counter' |
  'kiosk' | 'online' | 'drive_thru'), order_type ('dine_in' | 'takeaway' |
  'delivery'), status, customer_id (nullable), customer_phone, delivery_address,
  subtotal, discount_total, tax_total, total, notes, client_created_at,
  created_at, sent_to_kitchen_at, ready_at, collected_at.
- order_items: id (client UUID), order_id, menu_item_id, name_snapshot,
  unit_price, quantity, modifiers jsonb (snapshot of names and prices), combo
  selections jsonb, line_discount, line_tax, line_total, kds_station, notes,
  status ('pending' | 'sent' | 'ready' | 'voided'), voided_at, void_reason,
  voided_by, approved_by.

RPC submit_order(p_session_id, p_order jsonb) (security definer):
- validates the POS session and the order.create permission
- recalculates every price from the menu and branch overrides; validates modifier
  min/max and combo slot options; rejects unavailable items
- calculates taxes from the taxes table
- assigns order_number: branch daily sequence (e.g. 042), or keeps the
  device-generated offline number if provided (e.g. T1-042)
- inserts orders and order_items with snapshots
- is idempotent: calling it again with the same order id returns the saved order
  without changes
- writes audit_log
- returns the saved order with server totals

If the server total differs from the client preview, the till shows the server
total and a small notice.

Tests: pgTAP for submit_order (price tampering is ignored, idempotency, unavailable
item rejected, modifier rules). Playwright: build a combo order with modifiers and
submit it.
```

**Done when:**
- [ ] A cashier can build a 2-piece meal with swapped side and upsized drink in under 15 seconds
- [ ] Sending a fake price from the browser doesn't change the saved total
- [ ] Submitting the same order twice creates only one order
- [ ] Hold and recall work

---

## Phase 6: Payments and receipts

**Goal:** Take cash, card and mobile money (including split payments) and print receipts.

**Prompt:**

```text
Build payments and receipts from plan.md.

Payment screen (after "Pay"):
- Cash keypad with quick-amount buttons (exact amount and the next few round
  amounts), showing change due.
- Card and mobile money with a reference field (required if the payment method
  says so).
- Split payments across methods until the balance is zero.

Tables:
- payments: id (client UUID), order_id, branch_id, shift_id (nullable for now),
  method, amount, tendered (cash), change_given (cash), reference, status
  ('captured' | 'refunded'), staff_id, created_at.

RPC record_payments(p_session_id, p_order_id, p_payments jsonb):
- validates totals (sum of payments = order total, cash can be over-tendered)
- idempotent per payment id
- sets the order to 'paid' and sent_to_kitchen_at; lines become 'sent'
- writes audit_log

Setting 'orders.pay_later_dine_in': when on, dine-in orders can go to the kitchen
before payment.

Receipts:
- components/Receipt.tsx with print CSS for 80mm and 58mm paper: branch header and
  logo, order number, date/time in branch timezone, cashier name, items with
  modifiers, discounts, tax breakdown, payments, change, footer.
- lib/printing.ts with a PrinterDriver interface and a 'browser' driver using
  window.print(). Leave a stub for a future QZ Tray driver (raw ESC/POS) and
  document it.
- Reprint last receipt. Optional kitchen ticket print for branches without a KDS.
- Cash drawer: call driver.openDrawer() on cash payments (no-op in the browser
  driver; document that drawers usually open through the receipt printer).

Payment providers:
- lib/payments/provider.ts: a PaymentProvider interface with a 'manual' provider
  (cashier types the reference). Real card or mobile money integration comes later
  through an Edge Function and webhook.

Tests: payment totals validation, idempotency, split payment, over-tendered cash.
```

**Done when:**
- [ ] Cash, card, mobile money and split payments all work
- [ ] Change is correct for every quick-amount button
- [ ] Receipt prints correctly on 80mm paper (test on real printer)
- [ ] Paid orders reach status `paid` and lines become `sent`

---

## Phase 7: Shifts and cash management

**Goal:** All cash is accounted for: business days, shifts, floats, drops, blind counts and X/Z reports.

**Prompt:**

```text
Build business days, shifts and cash control from plan.md.

Tables:
- business_days: id, branch_id, business_date, opened_by, opened_at, closed_by,
  closed_at, status ('open' | 'closed'), z_report jsonb.
- shifts: id, branch_id, business_day_id, staff_id, device_id, opening_float,
  expected_cash, counted_cash, counted_denominations jsonb, variance, status
  ('open' | 'pending_review' | 'approved' | 'flagged'), opened_at, closed_at,
  reviewed_by, review_note.
- cash_movements: id (client UUID), shift_id, branch_id, type ('drop' | 'paid_in' |
  'paid_out' | 'no_sale'), amount, reason, staff_id, approved_by, created_at.

Rules and RPCs:
- open_business_day / close_business_day: manager permission day.open_close.
  No orders can be submitted unless the branch day is open. Closing requires
  every shift to be closed and generates the Z report.
- open_shift(p_session_id, p_opening_float): one open shift per cashier per device.
- From now on submit_order and record_payments require an open shift. Migrate
  orders.shift_id and payments.shift_id to NOT NULL for new rows safely.
- record_cash_movement: drops, paid in, paid out with reason; no_sale requires an
  override (drawer.no_sale).
- close_shift(p_session_id, p_counted_denominations): blind count (the cashier never
  sees expected cash before submitting). Expected cash = float + cash sales − cash
  change already netted − cash refunds + paid in − paid out − drops.
  Stores variance and sets status 'pending_review'.
- review_shift(p_shift_id, p_status, p_note): manager approves or flags.

UI:
- Till: open shift screen (count float by denomination), cash drop, paid in/out,
  no-sale (with override), close shift (blind count), X report print.
- Manager: day open/close page, shift reconciliation list with expected vs counted
  and variance highlighted above the 'cash.variance_alert' setting, Z report view
  and print.
- Denominations list configurable in settings per currency.

X report (shift so far) and Z report (day): sales by payment method, tax, discounts,
voids, refunds, number of orders, average order value, items sold, cash variance
per cashier.

Tests: expected cash formula with all movement types; can't sell without an open
shift; can't close day with open shifts; blind count never returns expected cash
to the cashier.
```

**Done when:**
- [ ] A full day works: open day → open shifts → sell → drop → close shifts → reconcile → close day
- [ ] Expected cash matches a hand calculation in tests
- [ ] Cashier can't see expected cash before counting
- [ ] X and Z reports print

---

## Phase 8: Voids, refunds, discounts and overrides

**Goal:** All exceptions are controlled by permission, approved when needed, and fully audited.

**Prompt:**

```text
Build voids, refunds, discounts and price overrides from plan.md.

- Void before sending: a cashier can remove lines from their own order before it is
  paid/sent (order.void_unsent). No approval.
- Void after sending: void_order_items(p_session_id, p_order_id, p_item_ids,
  p_reason, p_override_id) needs order.void_sent or a valid override. Reason from a
  list (customer changed mind, wrong item, quality issue, other + text). The KDS
  shows voided lines struck through with an alert.
- Refunds: refund_order(p_session_id, p_order_id, p_lines or full, p_method,
  p_reason, p_override_id) needs order.refund. Table refunds: id, order_id,
  shift_id, amount, method, reason, staff_id, approved_by, created_at. Cash refunds
  reduce the drawer's expected cash. Order status becomes refunded or
  partially_refunded.
- Discounts: line or order level, percent or fixed, with a reason. Within the
  staff member's discount_limit_bps it's allowed; above it needs
  discount.override. submit_order validates this on the server.
- Price override on a line: needs price.override.
- Every action writes actor and approver to audit_log.

Manager page "Exceptions": voids, refunds, discounts and no-sales by cashier and by
day, with totals, sortable and filterable, linking to the order detail.

Order lookup on the till and back office: search by order number, date, amount,
or payment reference; order detail shows lines, payments, voids, refunds and
the audit trail.

Tests: cashier can't refund without override; override can't be reused; discount
limit enforced server-side; refund reduces expected cash.
```

**Done when:**
- [ ] Every protected action asks for a manager PIN when the cashier lacks permission
- [ ] An override approval can't be used twice or after 2 minutes
- [ ] Exceptions report matches the audit log
- [ ] Refunds change expected cash correctly

---

## Phase 9: Offline mode

**Goal:** Tills keep taking orders and payments when the internet drops, and sync safely when it returns.

**Prompt:**

```text
Make the till work offline, following plan.md rules 6 and 10.

PWA:
- Make /till, /kds and /pickup an installable PWA using Serwist. Precache the app
  shell and static assets.

Local data (Dexie.js in lib/offline):
- Cache get_menu, settings, taxes, payment methods and the active staff list for the
  device's branch (including bcrypt PIN hashes and permissions) so PIN login and
  pricing work offline. Refresh on reconnect; remove deactivated staff on sync.
- Offline PIN check uses bcryptjs against cached hashes. Offline manager overrides
  are verified the same way and recorded locally.

Outbox:
- Every till write (submit_order, record_payments, cash movements, voids before
  send, shift open/close) goes into a Dexie outbox first, then a sync worker sends
  items in order when online, with exponential backoff.
- Because every RPC is idempotent on its client UUID, retries are safe.
- Offline actions are sent with is_offline = true and the original timestamps, and
  offline overrides are written to audit_log on sync.

Order numbers offline: device code + local daily counter (e.g. T1-042).

Kitchen fallback: Realtime needs the internet, so while the till is offline,
automatically print a kitchen ticket for every order (setting
'offline.print_kitchen_tickets').

UI:
- An offline banner with the number of unsynced items.
- Card/mobile money payments allowed offline only with a manual reference
  (setting).
- Block shift close and day close until the outbox is empty.
- A "Sync status" screen for managers showing pending and failed items with retry.

Tests (Playwright with network offline):
- Take 5 orders offline including payments, go online, check exactly 5 orders and
  their payments exist in the database.
- Kill the network mid-sync and confirm no duplicates.
```

**Done when:**
- [ ] With Wi-Fi turned off, a cashier can log in, sell, take cash, and print
- [ ] Kitchen tickets print while offline
- [ ] Reconnecting syncs everything once, with no duplicates
- [ ] Shift close is blocked until sync is complete

---

## Phase 10: Kitchen display and pickup screen

**Goal:** Orders appear instantly in the kitchen by station, and customers see when their order is ready.

**Prompt:**

```text
Build the kitchen display (KDS) and pickup screen from plan.md.

KDS (/kds, signed in as a KDS device; station from the device record or
?station= param):
- Subscribe to Supabase Realtime for the branch's orders and order_items.
- Ticket cards: order number, order type, channel, items and modifiers and notes
  for this station only, elapsed timer.
- Colours change at the thresholds in settings (e.g. 3 and 5 minutes).
- Tap an item or the whole ticket to bump it (RPC bump_items). When all stations are
  done, the order becomes 'ready' and ready_at is set.
- Recall the last 10 bumped tickets.
- Voided lines show struck through with an alert sound.
- An "All stations" / expo view for the assembly point.
- Big, readable layout for a wall-mounted screen; works with touch or a bump bar
  (keyboard keys 1–9).

Pickup screen (/pickup):
- Two columns: "Preparing" and "Ready" with large order numbers.
- Ready numbers disappear when collected or after N minutes (setting).
- Optional chime when a number becomes ready.

Till:
- An orders panel showing status of recent orders; cashier taps "Collected"
  (RPC mark_order_collected sets collected_at).

Record sent_to_kitchen_at, ready_at and collected_at for speed-of-service reports.

Tests: Playwright with two browser contexts (till and KDS): submit an order on the
till, see it on the KDS, bump it, see it on the pickup screen.
```

**Done when:**
- [ ] Orders appear on the right KDS station within 2 seconds
- [ ] Bumping moves orders to Ready on the pickup screen
- [ ] Voids show up on the KDS
- [ ] Timers and colours work

---

## Phase 11: Inventory

**Goal:** Stock is deducted automatically by recipe, and managers can receive, count and track waste.

**Prompt:**

```text
Build inventory from plan.md.

Tables:
- ingredients: id, name, unit ('pc' | 'g' | 'kg' | 'ml' | 'l' | 'pack'),
  cost_per_unit, reorder_level, is_active
- recipes: id, menu_item_id or modifier_id, ingredient_id, quantity
- branch_stock: branch_id, ingredient_id, quantity_on_hand
- stock_movements: id, branch_id, ingredient_id, type ('sale' | 'receive' |
  'waste' | 'count_adjust' | 'transfer_in' | 'transfer_out' | 'refund_return'),
  quantity (signed), reference_type, reference_id, reason, staff_id, created_at
- suppliers: id, name, phone, email
- purchase_orders, purchase_order_lines: supplier, expected date, lines, status
  ('draft' | 'sent' | 'received' | 'cancelled')
- stock_counts, stock_count_lines: counted quantity, expected quantity, variance

Rules:
- When an order becomes paid, write 'sale' movements for every recipe ingredient
  (items, chosen modifiers and combo selections) and update branch_stock. Do this
  inside record_payments (or an after-update trigger), idempotently.
- Voids after preparation don't return stock unless "returned to stock" is chosen.

Admin UI: ingredients, units, suppliers, recipe builder per item and modifier
(e.g. "Large fries" uses more potato than "Regular").

Manager UI:
- Receive a delivery against a purchase order (quantities and costs can differ).
- Record waste with reason (expired, dropped, overcooked).
- Stock count (full or by category) with variance and approval.
- Transfer stock to another branch.
- Low-stock list and alerts when quantity_on_hand < reorder_level.
- Suggested purchase order from the last 7/14 days of usage.

Reports: stock on hand, theoretical vs actual usage, waste by reason, stock value.

Tests: selling a combo deducts the right ingredients; idempotent deduction; count
variance correct.
```

**Done when:**
- [ ] Selling a 2-piece meal deducts the right chicken, side, cup and packaging
- [ ] Receiving, waste, counts and transfers update stock correctly
- [ ] Low-stock alerts appear
- [ ] Theoretical vs actual usage report works

---

## Phase 12: Reports and dashboards

**Goal:** Managers and admins get fast, accurate reports; cashiers see only their shift.

**Prompt:**

```text
Build reporting from plan.md.

Create Postgres functions report_* (security definer, permission-checked,
filtered by branch and date range using the branch timezone). All numbers are
computed in SQL, never in the browser.

Manager (own branch):
- Dashboard: today's sales, order count, average order value, compared with the
  same weekday last week; live open orders.
- Hourly sales, product mix (quantity and revenue), sales by channel and order
  type, payment methods, cashier performance, exceptions, speed of service (sent →
  ready → collected), Z report history.

Admin (all branches):
- Everything above with a branch filter and branch comparison.
- Tax report, discount and promotion cost report.
- CSV export of sales, payments and tax for the accountant.

Cashier: own shift summary only (X report).

Performance:
- Add indexes such as orders(branch_id, created_at), order_items(order_id),
  payments(order_id), audit_log(branch_id, created_at).
- Add a daily_sales_summary table filled on day close, used for long date ranges.
- Pages must load in under 2 seconds with a year of data (seed a large test
  dataset to check).

Charts with Recharts. Every chart has a table view and CSV download.

Tests: report totals match the Z report for the same day; managers can't run
reports for another branch.
```

**Done when:**
- [ ] Report totals match Z reports
- [ ] Manager sees only their branch; admin sees all
- [ ] CSV exports open correctly in Excel
- [ ] Reports load fast with a year of test data

---

## Phase 13: Promotions and loyalty

**Goal:** Run deals and reward regular customers without breaking pricing rules.

**Prompt:**

```text
Build promotions and loyalty from plan.md.

Promotions (admin, permission promo.manage):
- Types: percent off, fixed amount off, fixed combo price, buy X get Y.
- Conditions: date range, days of week, hours, branches, channels, order types,
  minimum spend, specific items or categories, coupon code, max total uses, max
  per customer.
- Priority and stacking rules (stackable or exclusive).
- Table promotion_redemptions records every use.

Engine:
- Promotion evaluation runs inside submit_order on the server. lib/pricing.ts
  mirrors it for the cart preview only.
- The till shows applied promotions on the cart and lets the cashier enter a
  coupon code.

Loyalty:
- customers: id, phone (unique), name, points_balance, consent_at, created_at.
- loyalty_transactions: earn and redeem, linked to orders.
- Look up a customer by phone on the till; earn points per amount spent (setting);
  redeem points as a discount; show the customer's recent orders.
- Customers must give consent before their phone number is stored.

Reports: promotion usage and cost, loyalty points issued and redeemed.

Tests: stacking rules, time windows in branch timezone, max uses, points
earn/redeem, refunds reverse points.
```

**Done when:**
- [ ] A lunchtime deal applies only during its hours and branches
- [ ] Coupons can't exceed max uses
- [ ] Points earn, redeem and reverse on refund
- [ ] Promotion cost report is correct

---

## Phase 14: Testing, security and launch

**Goal:** The system is safe, tested end to end, and ready for a real branch.

**Prompt:**

```text
Prepare the POS system for launch, following plan.md.

Security review:
- For every table, write pgTAP tests that try cross-branch reads and writes as a
  cashier device, a manager and anon, plus direct table writes that should only be
  possible through RPCs. Fix every failure.
- Run the Supabase security and performance advisors and fix the warnings.
- Confirm the service role key is only used server-side (search the codebase).
- Add rate limiting to server routes that create users or devices.

End-to-end tests (Playwright):
- A full day: open day → open two shifts → orders with combos and discounts →
  split payment → void with override → refund → offline period → close shifts →
  reconcile → close day → check Z report.

Reliability:
- Error monitoring (e.g. Sentry) for the app and Edge Functions.
- Uptime check on the production URL.
- Confirm the database backup schedule on the Supabase plan and test a restore
  into a separate project.

Training mode:
- A device setting that sends orders to a "Training" branch so staff can practise
  without affecting real reports.

Documentation:
- docs/user-guide: cashier quick guide, manager guide, admin guide.
- docs/hardware: tested tablets, printers, cash drawers and KDS screens, and how to
  set them up.
```

**Done when:**
- [ ] All RLS and end-to-end tests pass
- [ ] Supabase advisors show no critical warnings
- [ ] Backup restore has been tested
- [ ] Go-live checklist below is complete

### Go-live checklist

- [ ] Real menu, prices and combos entered and checked by the owner
- [ ] Tax rates confirmed with an accountant
- [ ] Hardware tested in the branch: tablets, receipt printer, cash drawer, KDS screen, pickup TV
- [ ] All staff created with PINs; managers trained on overrides and cash-up
- [ ] Offline drill: unplug the router during a test service and confirm sales continue and sync
- [ ] Staff practised in training mode
- [ ] Support contact and escalation plan agreed for the first week
- [ ] First live day: watch the Z report and cash variances closely

---

## Phase 15 (optional): Kiosk and online ordering

**Goal:** Customers order themselves in-store or online, and orders flow into the same kitchen.

**Prompt:**

```text
Add self-order kiosk and online ordering, following plan.md.

Kiosk (/kiosk on a kiosk device, portrait screen):
- Customer-friendly menu with big photos, combo builder, upsell prompts
  ("Make it a meal?"), accessibility options (larger text).
- Pay at counter (order waits as unpaid with a number) or pay by card through the
  payment provider.
- Uses submit_order with channel 'kiosk'. Idle timeout resets to the start screen.

Online ordering (public pages):
- Branch selector, public menu (read-only RPC exposing only active items and prices),
  cart, pickup time slots.
- Customer phone verification with Supabase Auth OTP.
- Online payment through a provider via an Edge Function, confirmed by webhook
  before the order goes to the kitchen.
- Orders land on the KDS with channel 'online'. Managers can pause online ordering
  per branch.
- Delivery platform orders can be received later through Edge Function webhooks
  using the same submit_order logic.

Tests: kiosk and online orders appear on the KDS and in reports with the right
channel; unpaid online orders never reach the kitchen.
```

**Done when:**
- [ ] Kiosk orders reach the kitchen and the counter can take payment for them
- [ ] Online orders only reach the kitchen after payment is confirmed
- [ ] Online ordering can be paused per branch

---

## Appendix A: Database migrations workflow

Save as `.github/workflows/db-migrations.yml`. It runs whenever migration files change on `main`.

```yaml
name: Deploy database migrations

on:
  push:
    branches: [main]
    paths:
      - "supabase/migrations/**"
  workflow_dispatch:

jobs:
  migrate:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase link --project-ref "$SUPABASE_PROJECT_ID"
      - run: supabase db push
```

**Where to get the secrets**
- `SUPABASE_ACCESS_TOKEN`: Supabase dashboard → Account → Access tokens
- `SUPABASE_DB_PASSWORD`: the database password you set when creating the project
- `SUPABASE_PROJECT_ID`: the project reference in your Supabase URL (`https://<project-id>.supabase.co`)

Add them in GitHub → your repo → Settings → Secrets and variables → Actions.

**Daily workflow for database changes**

```bash
supabase migration new add_shifts_table   # creates an empty migration file
# write the SQL in the new file
supabase db reset                          # rebuild local database and run seed
supabase test db                           # run database tests
git add . && git commit -m "Add shifts table"
git push                                   # after merge to main, the Action applies it
```

---

## Appendix B: Environment variables

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | Safe for the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | Safe for the browser; protected by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server only) + `.env.local` | Never prefix with `NEXT_PUBLIC_`; never commit |
| `SUPABASE_ACCESS_TOKEN` | GitHub secrets | For migrations only |
| `SUPABASE_DB_PASSWORD` | GitHub secrets | For migrations only |
| `SUPABASE_PROJECT_ID` | GitHub secrets | For migrations only |

Use a separate Supabase project for development and testing, so Vercel preview deployments never touch real sales data.

---

## Appendix C: Glossary

| Term | Meaning |
|---|---|
| KDS | Kitchen display system: screens that replace paper kitchen tickets |
| Bump | Marking an item or ticket as done on the KDS |
| Float | Cash put in the drawer at the start of a shift for giving change |
| Cash drop | Moving excess cash from the drawer to the safe during a shift |
| Blind count | Counting the drawer without seeing how much the system expects |
| Variance | Difference between counted cash and expected cash |
| X report | Running summary of a shift, without closing it |
| Z report | End-of-day summary that closes the business day |
| No-sale | Opening the cash drawer without a transaction |
| Void | Cancelling an item or order before or after it reaches the kitchen |
| Override | A manager approving an action the cashier isn't allowed to do alone |
| Basis points (bps) | Hundredths of a percent: 1000 bps = 10% |
| Minor units | Smallest currency unit (e.g. cents): 12.50 is stored as 1250 |
| RLS | Row Level Security: database rules deciding who can see and change each row |
| RPC | A Postgres function called from the app to do a protected action |
| Idempotent | Safe to repeat: sending the same request twice has the same effect as once |