# Live D1 verification and release runbook

This runbook prepares steps 16–20 of `COMPLETION_TRACKER_30.md`. It is a procedure, not evidence that production checks have run. No command in this document should be run against production until the database owner has approved the exact operation.

## Known target (must be independently re-confirmed)

The repository currently declares:

- D1 name: `contentpilot-db`
- D1 database ID: `22b74080-2843-4629-bc37-af0ba790ed08`
- Worker binding: `DB`
- Worker: `contentpilot-ai`

These are repository configuration values, not proof that the currently authenticated Cloudflare account or production Worker is attached to this database. Never change the ID to make a command succeed.

## 16. Verify production D1 identity, schema and existing data

Use an authenticated Cloudflare account with read-only access first. From the repository root:

```sh
npx wrangler d1 list --json
npx wrangler d1 info contentpilot-db --json
npx wrangler d1 migrations list contentpilot-db --remote
```

Stop if the account, database name, UUID, or Worker binding does not match the intended production resource. Save the command output as release evidence, but redact account identifiers or operational metadata before sharing publicly.

Read-only schema checks (avoid selecting user content or credentials):

```sh
npx wrangler d1 execute contentpilot-db --remote --command="SELECT name, type FROM sqlite_schema WHERE type IN ('table','index') ORDER BY type, name"
npx wrangler d1 execute contentpilot-db --remote --command="PRAGMA foreign_key_check"
```

Confirm expected application tables from the current Worker queries, plus `generation_reservations`, `auth_rate_limits`, and the indexes defined by migrations 0001 and 0002. Record row counts only where operationally necessary; do not export or paste user records into tickets or chat. A missing migration table is a stop condition, not an invitation to deploy the Worker.

## 17. Backup and prove restore in an isolated environment

Before any migration:

1. Obtain explicit approval for a production export because it contains account and application data.
2. Store the export outside the repository in encrypted, access-controlled storage. Never commit it, attach it to a PR, or paste it into chat.
3. Export using Wrangler:

```sh
npx wrangler d1 export contentpilot-db --remote --output ./private-contentpilot-backup.sql
```

4. Record the export time, database UUID, file size and a cryptographic checksum in the private operations record. Confirm the export completed successfully and the file is non-empty.
5. Prove restoration only into a separately provisioned, disposable D1 database with explicit owner approval. Do not restore over production. Compare schema, table counts and `PRAGMA foreign_key_check` results on the isolated copy; securely delete the disposable copy and backup according to the approved retention policy.

A successful export alone is not a verified backup/restore. Do not mark step 17 complete until the isolated restore has been tested and recorded.

## 18. Review and apply migrations 0001 and 0002

Review the SQL files in this repository and the remote migration list. The two migrations add durable generation reservations and authentication rate-limit storage. Confirm the expected foreign-key parent table exists and that the remote database is the approved target.

Only after steps 16 and 17 are evidenced and the owner explicitly approves the schema change:

```sh
npx wrangler d1 migrations apply contentpilot-db --remote
npx wrangler d1 migrations list contentpilot-db --remote
```

Wrangler prompts for confirmation in interactive use and captures a backup after applying migrations. Still retain the separately verified backup from step 17. Verify the new tables and indexes with the schema query in step 16. Do not deploy the Worker as part of this database operation; deployment is a separate release action.

## 19. Live D1 integration, concurrency and recovery tests

Do not run concurrency or mutation tests against production. Provision a staging Worker and a separate staging D1 database with the same schema, using test-only accounts and no real customer data. Point the staging Worker at that database and verify the deployed build/commit before testing.

Required evidence:

- Registration/login/session creation and logout persist across separate requests.
- Concurrent generation attempts at the free-quota boundary never exceed the configured allowance.
- A credit reservation debits the wallet and writes exactly one matching ledger entry.
- Successful generation transitions one reservation from `reserved` to `consumed`.
- Repeated failure/refund attempts cannot restore quota or credits more than once.
- Simulated failure between reservation and completion can be recovered without double charge or double refund.
- D1 batch errors leave no partial wallet/ledger/reservation state.
- Authentication rate-limit counters persist and expire through the scheduled cleanup path.

Use unique disposable users and deterministic request IDs. Capture request IDs, status codes and aggregate assertions only; never log passwords, bearer tokens, email verification tokens or full user content. A passing mocked unit test is not a substitute for this staging D1 evidence.

## 20. End-to-end account and generation checks

Use a disposable account on the staging site connected only to the staging Worker and D1. Never use the owner's personal account or production customer data. Verify:

1. Register, reject duplicate registration, log in and inspect the authenticated account/quota view.
2. Log out; confirm the old session is rejected. Log in again, then test expiry/revocation.
3. Generate text in Persian and English; confirm successful output and quota accounting.
4. Force a controlled generation failure; confirm no quota/credit is consumed or refunded twice.
5. Generate an image; verify the response MIME signature, preview and download.
6. Test unauthenticated access, invalid JSON, unsupported methods and oversized bodies.
7. Repeat on current desktop and mobile browsers; record browser/version, staging commit, date, outcome and non-sensitive evidence.

Delete the disposable test account/data only through a verified test cleanup process. Do not add a production account-deletion path just to clean up test data.

## Stop conditions

Stop and ask the owner before proceeding if the database UUID differs, the backup cannot be verified, an unexpected schema/data state appears, migrations are already partially applied, staging shares production resources, or any test would mutate production data. Never use `--yes`, skip confirmations, run a restore, or deploy as an implicit part of this checklist.

## Current status

The repository contains this runbook and automated mocked/SQLite tests. Steps 16–20 remain unchecked until their live evidence exists. The production D1 identity, backup/restore, migration state, live concurrency behavior and disposable-account E2E flows have not been verified by this document.
