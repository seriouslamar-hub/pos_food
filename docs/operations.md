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

- **Nightly backups (all plans):** `.github/workflows/backup.yml` runs at 02:30 UTC every night. It dumps the production database (roles, schema and all data, including logins), encrypts it with the `BACKUP_PASSPHRASE` secret (openssl AES-256 with PBKDF2; macOS and Linux have openssl built in) and keeps it for 30 days under **Actions → Nightly database backup → Artifacts**. The repository is public, so backups are only stored encrypted. Keep the passphrase somewhere safe outside GitHub (a password manager): without it the backups can't be opened. You can also run it on demand from the Actions tab.
- **Supabase's own backups:** on the Pro plan Supabase also keeps daily backups for 7 days (point-in-time recovery is an add-on). As of 16 Oct 2026 the project showed none, which is the free plan.

### Test a restore (before go-live, then every quarter)

1. Download the latest backup artifact from the Actions tab and unzip it, which gives `pos-backup-YYYYMMDD-HHMM.tar.gz.enc`.
2. With the local stack running (`supabase start`, then `supabase db reset --no-seed`), run `scripts/restore-backup.sh pos-backup-....tar.gz.enc` and enter the passphrase. It prints how many logins, orders and audit entries came back. Compare them with production.
3. **Restoring for real** (production is lost):
   1. Create a new Supabase project.
   2. Apply the migrations: `supabase link --project-ref <new>` then `supabase db push`.
   3. Run `scripts/restore-backup.sh <file> "<new project's database URL>"`.
   4. Point Vercel's three Supabase variables at the new project and redeploy.
4. Write down the date and how long it took.

**Restore test, 16 Oct 2026:** production dump restored into a freshly migrated local database in under a second. Logins (with password hashes), staff, branches, settings, permissions and all 73 audit entries matched production exactly.

## Online ordering setup

Payments are taken at the counter: customers choose cash, card or mobile money when they order, and the cashier takes it from **Unpaid orders** on the till. No payment gateway is needed.

1. **Phone codes (Arkesel):** the Vercel variables `ARKESEL_API_KEY` (sensitive) and `ARKESEL_SENDER_ID` (your **approved** sender ID). Supabase's Send SMS hook already points at `https://pos-food-system.vercel.app/api/auth/sms-hook` with the secret in `SMS_HOOK_SECRET`. Keep SMS credit topped up in Arkesel; each code is one SMS.
2. **Switch it on:** Admin → Settings → **Online ordering** on, and set the earliest pickup time.
3. **Test it:** order from `/order` on your phone, pay at the till, and check it reaches the kitchen screen.
4. **Optional online payments:** the Paystack integration is built in but off. To use it, set `PAYMENTS_PROVIDER=paystack` and `PAYSTACK_SECRET_KEY` in Vercel and the webhook URL in Paystack.

Auth settings set on 16 Oct 2026: self sign-up **off**, site URL `https://pos-food-system.vercel.app`, minimum password length 8.

## Security checklist

- **Service role key:** only in Vercel (server-only) and never in code. `lib/supabase/admin.ts` imports `server-only`, so browser code can't use it.
- **Database tests** (`supabase test db`) check:
  - every table has RLS
  - anonymous users reach nothing
  - managers and tills see no other branch's rows
  - money tables can only change through RPCs
- **Rate limits:** creating logins, devices and setup codes is rate limited (`public.rate_limits`).
- **Supabase advisors:** run them after each phase (Supabase → Advisors). The "security definer function executable" warnings are the app's RPC API and are expected; each function checks permissions itself.
- **Passwords:** at least 8 characters (set 16 Oct 2026). **Leaked-password protection** (refusing passwords known from data breaches) needs the Supabase Pro plan: turn it on under Authentication → Policies after upgrading.
- **Repository visibility:** the GitHub repository is public. No secrets are in it, but making it private (Settings → Danger zone) keeps your setup to yourselves.

## Go-live checklist

- [ ] Real menu, prices and combos entered and checked by the owner
- [ ] Tax rates confirmed with an accountant
- [ ] Hardware tested in the branch (see `docs/hardware.md`)
- [ ] All staff created with PINs; managers trained on approvals and cash-up
- [ ] Offline drill: unplug the router during a test service, then confirm sales continue and sync
- [ ] Staff have practised in training mode
- [x] Nightly encrypted backups running; restore tested (16 Oct 2026)
- [ ] Support contact and escalation plan agreed for the first week
- [ ] First live day: watch the Z report and cash differences closely
