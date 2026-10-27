# Database backup (GitHub Actions -> Cloudflare R2)

`.github/workflows/db-backup.yml` dumps the Atlas database every night (01:30 Oman),
encrypts it with a passphrase and uploads it to a private R2 bucket:

- `daily/ngdp-<date>.archive.gz.gpg` - a full snapshot of the whole database, kept 30 days

Atlas free (M0) clusters cannot enable Atlas backups, so this is the only backup.

## One-time setup

**1. Read-only Atlas user.** Database Access -> Add user -> password auth -> *Specific
Privileges* -> role `read` on the app's database (not `atlasAdmin`). Copy its connection
string with the database name in the path (`.../<dbname>?...`).

**2. Atlas network access.** GitHub runners have no fixed IP, so the backup user can only
connect if the IP Access List allows `0.0.0.0/0`. The read-only role plus a long random
password is what limits the exposure.

**3. R2 bucket.** Cloudflare -> R2 -> Create bucket (private; leave public access off).
Then:
- *Manage R2 API Tokens* -> create a token with **Object Read & Write**, scoped to this
  bucket only. Note the Access Key ID, Secret Access Key and your Account ID.
- Bucket -> Settings -> Object lifecycle rules: delete objects under `daily/` after 30 days
  (the workflow only uploads; this rule is what removes old backups).

**4. Repository secrets** (Settings -> Secrets and variables -> Actions):

| Secret | Value |
|---|---|
| `MONGO_URI_BACKUP` | step 1 connection string |
| `BACKUP_PASSPHRASE` | a long random passphrase - also store it in a password manager; without it the backups are unreadable |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_BUCKET` | bucket name |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | step 3 token |

**5. First run.** Actions -> *Database backup* -> *Run workflow*. Check that the run is
green and an object appears under `daily/`. GitHub emails you when a scheduled run fails.
(Scheduled workflows in a public repo are disabled after 60 days without repository
activity - re-enable from the Actions tab if that ever happens.)

## Restore

Do a test restore once after the first run, and again every few months.

1. Download the `.gpg` file from the R2 dashboard (bucket -> object -> Download).
2. Decrypt (prompts for the passphrase):
   ```bash
   gpg --decrypt --output dump.archive.gz ngdp-2026-10-18_2130.archive.gz.gpg
   ```
3. Restore into a scratch database first, to inspect it without touching live data:
   ```bash
   mongorestore --uri="$NEW_URI" --gzip --archive=dump.archive.gz \
     --nsInclude='<dbname>.*' --nsFrom='<dbname>.*' --nsTo='restore_test.*'
   ```
4. For a real restore, drop the `--nsFrom/--nsTo` and add `--drop`, **with the API service
   paused** so nothing writes during the restore.

`mongodump`/`mongorestore` come from the MongoDB Database Tools
(`winget install MongoDB.DatabaseTools` on Windows).
