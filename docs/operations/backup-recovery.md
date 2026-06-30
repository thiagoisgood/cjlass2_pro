# Backup, Recovery, and Secret Rotation Runbook

## PostgreSQL logical backup

Run a custom-format backup with a manifest:

```bash
DATABASE_URL=postgres://user:pass@host:5432/cjlass2 \
BACKUP_DIR=backups/postgres \
npm run ops:backup
```

Optional object storage upload:

```bash
OBJECT_STORAGE_URI=s3://cjlass2-prod-backups/postgres \
DATABASE_URL=postgres://user:pass@host:5432/cjlass2 \
npm run ops:backup
```

The backup script writes:

- `*.dump`: `pg_dump --format=custom`
- `*.manifest.json`: creation time, SHA-256, redacted database URL, WAL/object-storage target

## WAL archiving

For production PostgreSQL, enable point-in-time recovery:

```conf
wal_level = replica
archive_mode = on
archive_timeout = 60s
archive_command = 'test ! -f /wal-archive/%f && cp %p /wal-archive/%f'
```

For object storage, replace `archive_command` with an audited uploader, for example `wal-g wal-push %p` or `aws s3 cp %p s3://cjlass2-prod-backups/wal/%f`. Keep WAL and logical dumps in the same retention policy.

Minimum retention target:

- logical dump: daily for 14 days, weekly for 8 weeks
- WAL: enough to restore to any point in the last 7 days
- manifest: retain with each dump and verify SHA-256 before restore

## Restore

Dry-run a backup file:

```bash
BACKUP_FILE=backups/postgres/cjlass2-2026-06-29.dump \
RESTORE_DRY_RUN=true \
npm run ops:restore
```

Restore into a target database:

```bash
BACKUP_FILE=backups/postgres/cjlass2-2026-06-29.dump \
RESTORE_DATABASE_URL=postgres://user:pass@host:5432/cjlass2_restore \
npm run ops:restore
```

## Restore drill

Run this against an isolated drill database, never production:

```bash
BACKUP_FILE=backups/postgres/cjlass2-2026-06-29.dump \
DRILL_DATABASE_URL=postgres://user:pass@host:5432/cjlass2_drill \
npm run ops:restore:drill
```

The drill lists archive contents, restores with `pg_restore --clean --if-exists`, then checks core tables: `tenants`, `audit_logs`, and `knowledge_docs`.

## Secret rotation

Generate a reviewed env patch:

```bash
AUTH_SESSION_SECRET=current-session-secret \
API_AUTH_TOKEN=current-api-token \
ROTATION_ENV_FILE=.secrets.rotation.env \
npm run ops:rotate-secrets
```

Deploy order:

1. Apply generated `AUTH_SESSION_SECRET` and `API_AUTH_TOKEN`.
2. Keep `AUTH_SESSION_PREVIOUS_SECRETS` and `API_AUTH_TOKEN_PREVIOUS` during the overlap window.
3. Wait at least `AUTH_SESSION_TTL_SECONDS`.
4. Remove previous secret/token entries.
5. Confirm `/api/v1/audit-logs` shows successful admin login after rotation.
