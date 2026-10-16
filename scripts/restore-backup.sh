#!/usr/bin/env bash
# Restores a nightly backup (from .github/workflows/backup.yml) into a
# database: the LOCAL Supabase stack by default, for a restore test, or the
# database URL you give (a new, empty Supabase project with this repo's
# migrations applied).
#
#   scripts/restore-backup.sh pos-backup-20261016-0230.tar.gz.gpg            # local test
#   scripts/restore-backup.sh pos-backup-....tar.gz.gpg "postgresql://..."   # another project
#
# Asks for the backup passphrase. Never point it at the live database: it
# empties the tables before loading the backup.
set -euo pipefail
file="${1:?Usage: scripts/restore-backup.sh <backup.tar.gz.gpg> [database-url]}"
target="${2:-}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gpg --decrypt -o "$work/backup.tar.gz" "$file"
tar -xzf "$work/backup.tar.gz" -C "$work"

# Supabase-managed storage tables aren't restored (they hold no app data).
python3 - "$work" <<'PY'
import re, sys
work = sys.argv[1]
out, skip = [], False
for line in open(f"{work}/data.sql"):
    m = re.match(r'^COPY "([a-z_]+)"\."([a-z_]+)"', line)
    if m:
        schema, table = m.groups()
        skip = schema == "storage" and table not in ("buckets", "objects")
    if not skip:
        out.append(line)
    if skip and line.strip() == "\\.":
        skip = False
open(f"{work}/restore.sql", "w").writelines(out)
PY

{
  echo "begin;"
  echo "set session_replication_role = replica;"
  echo "do \$\$ declare t record; begin
    for t in select schemaname, tablename from pg_tables
      where (schemaname in ('public', 'auth') and tablename <> 'schema_migrations')
         or (schemaname = 'storage' and tablename in ('buckets', 'objects'))
    loop execute format('truncate %I.%I cascade', t.schemaname, t.tablename); end loop;
  end \$\$;"
  cat "$work/restore.sql"
  echo "commit;"
} > "$work/load.sql"

if [ -z "$target" ]; then
  container="$(docker ps --format '{{.Names}}' | grep '^supabase_db_fastfood-pos$')"
  docker exec -i "$container" psql -U postgres -q -v ON_ERROR_STOP=1 < "$work/load.sql"
  docker exec "$container" psql -U postgres -tAc \
    "select 'restored: ' || (select count(*) from auth.users) || ' logins, ' || (select count(*) from public.orders) || ' orders, ' || (select count(*) from public.audit_log) || ' audit entries'"
else
  psql "$target" -q -v ON_ERROR_STOP=1 < "$work/load.sql"
fi
echo "Done. Check sign-in, yesterday's Z report and stock before trusting it."
