# Fast-Food POS

A point-of-sale system for fast-food businesses with one or more branches. It covers counter ordering, payments, receipts, the kitchen display, the customer pickup screen, cash and shift control, inventory, reports and promotions. An offline mode keeps the tills selling when the internet drops.

The build plan, with rules, roles, data model and every phase, is in [claude.md](claude.md).

## Tech stack

- Next.js 16 (App Router), TypeScript in strict mode, Tailwind CSS 4 and shadcn/ui
- Supabase: Postgres, Auth, Row Level Security, Realtime, Storage and Edge Functions
- Vitest for unit tests, pgTAP (`supabase test db`) for database tests and Playwright for end-to-end tests (from Phase 2)
- GitHub Actions for CI and database migrations, and Vercel for hosting

## Running locally

You need Node.js 22 or newer. To run the database locally you also need Docker Desktop.

```bash
npm install
cp .env.example .env.local      # then fill in the values (see below)
npm run dev                     # http://localhost:3000
```

### Option A: a local Supabase database (recommended for development)

```bash
npm run db:start                # starts Postgres, Auth, Studio etc. in Docker
```

`db:start` prints a local API URL (http://127.0.0.1:55321) and anon key. Put them in `.env.local`. Supabase Studio runs at http://127.0.0.1:55323.

This project's local ports are 553xx rather than Supabase's default 543xx, so it can run alongside another local Supabase project. They're set in `supabase/config.toml`.

```bash
npm run db:reset                # rebuild the local database from migrations + seed.sql
npm run db:test                 # run the pgTAP tests in supabase/tests
```

`seed.sql` creates these local test accounts. The password for every login is `password123`.

| Login                     | Who                                     | Till PIN    |
| ------------------------- | --------------------------------------- | ----------- |
| `admin@example.com`       | Admin, all branches                     | 9000        |
| `manager@example.com`     | Manager, Main branch                    | 9999        |
| `device-t1@example.com`   | Till device T1                          |             |
| `device-kds1@example.com` | Kitchen display K1                      |             |
| (no login)                | Ama Cashier / Kofi Cashier, Main branch | 1111 / 2222 |

### Option B: a hosted Supabase project

Put the project's URL and keys in `.env.local`. Use a separate project for development, never the production one.

## Environment variables

| Variable                        | Where                               | Notes                                                                                                  |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Vercel + `.env.local`               | Safe for the browser                                                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local`               | Safe for the browser; Row Level Security protects the data                                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | Vercel (server only) + `.env.local` | Bypasses Row Level Security. Never prefix with `NEXT_PUBLIC_`, never use in browser code, never commit |
| `SUPABASE_DB_URL`               | `.env.local` only (optional)        | Lets you push migrations from your machine                                                             |
| `SUPABASE_ACCESS_TOKEN`         | GitHub secrets                      | Used by the migrations workflow                                                                        |
| `SUPABASE_DB_PASSWORD`          | GitHub secrets                      | Used by the migrations workflow                                                                        |
| `SUPABASE_PROJECT_ID`           | GitHub secrets                      | The `<project-id>` in `https://<project-id>.supabase.co`                                               |

All `.env*` files except `.env.example` are gitignored.

## Scripts

| Command                                        | What it does                                                  |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                                  | Start the app in development mode                             |
| `npm run build`                                | Production build                                              |
| `npm run lint`                                 | ESLint                                                        |
| `npm run typecheck`                            | Generate Next.js route types and run `tsc --noEmit`           |
| `npm test`                                     | Vitest unit tests                                             |
| `npm run format`                               | Format everything with Prettier                               |
| `npm run db:new <name>`                        | Create an empty migration file                                |
| `npm run db:reset`                             | Rebuild the local database and load `supabase/seed.sql`       |
| `npm run db:test`                              | Run the database tests                                        |
| `npm run db:types`                             | Regenerate `lib/supabase/database.types.ts` after a migration |
| `npm run test:e2e`                             | Playwright end-to-end tests against the local database        |
| `npm run admin:create -- --email … --name "…"` | Create the first admin in the project `.env.local` points to  |

## Database migrations

Every database change is a migration file in `supabase/migrations/`. Never change the production database by hand.

```bash
npm run db:new add_shifts_table   # creates supabase/migrations/<timestamp>_add_shifts_table.sql
# write the SQL in the new file
npm run db:reset                  # rebuild the local database and run the seed
npm run db:test                   # run the database tests
git add . && git commit -m "Add shifts table"
git push                          # open a pull request; merge to main when CI passes
```

Write migrations so the previous app version keeps working while the new one deploys: add columns first, use them in a later release, and remove old ones last.

### How migrations reach production

[.github/workflows/db-migrations.yml](.github/workflows/db-migrations.yml) runs when files in `supabase/migrations/` change on `main`, and you can also run it by hand from the Actions tab. It links to the project with `SUPABASE_PROJECT_ID` and runs `supabase db push`, which applies any migrations the project doesn't have yet.

Add these secrets in GitHub → your repo → Settings → Secrets and variables → Actions:

- `SUPABASE_ACCESS_TOKEN`: Supabase dashboard → Account → Access tokens
- `SUPABASE_DB_PASSWORD`: the database password you set when you created the project
- `SUPABASE_PROJECT_ID`: the project reference from your Supabase URL

`seed.sql` is for local test data only. `supabase db push` never runs it.

## Deployment

1. Push the repo to GitHub.
2. Import it in Vercel and add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. Leave the service role key unexposed to the browser.
3. Every push to `main` deploys the app, and the migrations workflow updates the database.

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint, type-check and unit tests, and builds the database from the migrations to run the pgTAP tests, on every pull request and push to `main`.

## Signing in

- **Admins and managers** sign in at `/login` with email and password. Admins land on `/admin`, managers on `/manager`. Cashiers, devices and deactivated staff are refused.
- **The first admin** of a new project is created with `npm run admin:create -- --email you@example.com --name "Your Name"`. It prints a temporary password once. After that, admins create staff from the back office (Phase 3).
- **Tills, kitchen displays and pickup boards** are set up at `/device/setup`. Either enter the one-time setup code an admin got when creating the device (valid 24 hours, works once), or have an admin or manager sign in there and pick the device. The browser is then signed in as the device with a one-time token (devices have no password) and stays signed in after restarts. Admins can sign a lost device out everywhere from its page.
- **Cashiers** tap their 4–6 digit PIN on the till. Five wrong PINs within 5 minutes lock the till for a minute. The till locks itself after `till.auto_lock_minutes` without activity (default 5).
- **Manager approval:** when a cashier lacks a permission, the till asks for the PIN of someone who has it. The approval lasts 2 minutes, works once, and every attempt is written to the audit log.

## Back office

- **Admins** (`/admin`) manage branches (with logos), staff, devices, taxes, payment methods, the role permission grid, settings (global defaults with per-branch values) and the audit log.
- **Managers** (`/manager`) add, edit and deactivate cashiers in their own branch, set their PINs, and read their branch's audit log. They can't give a cashier a bigger discount limit than their own.
- Creating an admin or manager makes their login and shows a temporary password once. There is always at least one active admin.
- Reactivating someone or moving them to another branch clears their PIN, because it might now clash with a colleague's.

## End-to-end tests

```bash
npm run db:start && npm run db:reset   # local stack with fresh seed data
npm run test:e2e                        # starts the app on port 3100 against the local database
```

The tests read the local keys from `supabase status` and refuse to run against anything that isn't localhost, so they never touch production.

## Project structure

```text
app/
  (auth)/login               back-office login
  (backoffice)/admin         admin pages
  (backoffice)/manager       manager pages
  device/setup               register a till, KDS or pickup device
  till                       cashier POS screens
  kds                        kitchen display
  pickup                     customer pickup board
components/                  shared UI (shadcn/ui primitives live in components/ui)
lib/
  supabase/                  client.ts (browser), server.ts (server), admin.ts (service role, server only),
                             proxy.ts (session refresh and route protection), database.types.ts (generated)
  auth.ts                    getSignedInUser, requireStaff for pages and Server Actions
  permissions.ts             permission keys and can()
  routes.ts                  which roles and devices may open which paths
  till.ts, till-session.tsx  till session types, RPC parsing, usePermission()
  money.ts                   formatMoney, parseMoney
  offline/                   Dexie database, outbox, sync worker (Phase 9)
  payments/                  payment provider interface (Phase 6)
proxy.ts                     runs on every request and refreshes the Supabase session
supabase/
  migrations/                every database change, in order
  tests/                     pgTAP tests for RLS and functions
  functions/                 Edge Functions
  seed.sql                   local test data only
scripts/                     one-off admin scripts (create the first admin)
tests/e2e/                   Playwright end-to-end tests
.github/workflows/           CI and database migrations
```

## Notes for developers

- **Money** is stored as integers in minor units (1250 = 12.50). Use `formatMoney()` to display it and `parseMoney()` to read typed input. Never use floats.
- **`proxy.ts`** is Next.js 16's new name for `middleware.ts`. It works the same way.
- **Cache Components** is on. Any component that reads cookies or the session must sit inside a `<Suspense>` boundary. See `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`.
- **Staff queries must list columns.** The API can never read `staff.pin_hash`, so `select('*')` on `staff` fails with "permission denied". Select the columns you need, and use `has_pin` to show whether a PIN is set.
- **New database functions aren't callable from the app by default.** Grant `execute` to `authenticated` explicitly, and add the function to the allowlist in `supabase/tests/001_schema_security.test.sql`.
