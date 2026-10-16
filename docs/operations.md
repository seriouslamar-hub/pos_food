# Operations: backups, monitoring and go-live

## Where things run

| Part     | Where                                                     | Notes                                                                                                                                                                             |
| -------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App      | Vercel project `pos-food-system`                          | Deploys from `main`. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), optional `ERROR_WEBHOOK_URL`. |
| Database | Supabase project `fast_food_pos` (`avpjyykdsyeyrhnmpmfc`) | Changed only by migrations in `supabase/migrations`, applied by the GitHub Action on push to `main`.                                                                              |
| Code     | GitHub `seriouslamar-hub/pos_food`                        | CI (lint, types, unit tests) runs on every push and pull request.                                                                                                                 |

## Monitoring

- **Uptime:** `.github/workflows/uptime.yml` calls `/api/health` every 15 minutes. If the app can't reach Supabase, the run fails and GitHub emails the repository owner. Check **Actions → Uptime check** for the history. An external monitor (UptimeRobot, Better Stack) pointed at `https://pos-food-system.vercel.app/api/health` gives faster alerts.
- **Errors:**
  - **What's reported:** server errors (pages, server actions, routes) and browser errors (tills, back office).
  - **Where they go:** each is written as one JSON line to the Vercel logs (**Project → Logs**, filter `"level":"error"`).
  - **Alerts:** set `ERROR_WEBHOOK_URL` in Vercel to a Slack, Discord or Teams incoming webhook to be told straight away.
  - **Sentry:** to use Sentry instead, add `@sentry/nextjs` and call it from `lib/monitoring/report.ts`.
- **Tills offline:** **Admin → Devices** shows each device's last contact and how many sales it hasn't sent yet.

## Backups

- **Daily backups:** Supabase takes them on paid plans (Pro keeps 7 days; Point-in-Time Recovery is an add-on). Check **Supabase → Database → Backups** shows recent backups.
- **Free plan:** there are no automatic backups. Upgrade before going live, or schedule `supabase db dump` yourself.

### Test a restore (do this before go-live, then every quarter)

1. Create a new, separate Supabase project (e.g. `pos-restore-test`).
2. Restore into it:
   - **From a dump:** download the latest backup (Database → Backups) and load it.
   - **Or:** `supabase db dump --db-url "$PROD_DB_URL" -f prod.sql` (and `--data-only -f data.sql`), then load both into the new project with `psql`.
3. Point a local copy of the app at the restored project (`.env.local`) and check:
   - you can sign in
   - yesterday's Z report matches
   - order totals and stock look right
4. Delete the test project.
5. Write down the date and how long it took.

## Security checklist

- **Service role key:** only in Vercel (server-only) and never in code. `lib/supabase/admin.ts` imports `server-only`, so browser code can't use it.
- **Database tests** (`supabase test db`) check:
  - every table has RLS
  - anonymous users reach nothing
  - managers and tills see no other branch's rows
  - money tables can only change through RPCs
- **Rate limits:** creating logins, devices and setup codes is rate limited (`public.rate_limits`).
- **Supabase advisors:** run them after each phase (Supabase → Advisors). The "security definer function executable" warnings are the app's RPC API and are expected; each function checks permissions itself.
- **Leaked-password protection:** turn on Supabase → Authentication → Policies → **Leaked password protection** (paid plans).

## Go-live checklist

- [ ] Real menu, prices and combos entered and checked by the owner
- [ ] Tax rates confirmed with an accountant
- [ ] Hardware tested in the branch (see `docs/hardware.md`)
- [ ] All staff created with PINs; managers trained on approvals and cash-up
- [ ] Offline drill: unplug the router during a test service, then confirm sales continue and sync
- [ ] Staff have practised in training mode
- [ ] Backups confirmed and a restore tested
- [ ] Support contact and escalation plan agreed for the first week
- [ ] First live day: watch the Z report and cash differences closely
