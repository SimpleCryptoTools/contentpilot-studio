# Account and data lifecycle inventory

## Scope and confidence

This is a repository-level inventory based on SQL statements and browser storage references in the current branch. It is not a live inspection of Cloudflare D1 and does not establish the complete production schema. The repository does not contain baseline CREATE TABLE migrations for the existing account, wallet, order and usage tables.

## Data locations

| Data store | Known data | Ownership / behavior | Deletion status |
| --- | --- | --- | --- |
| D1 users | id, email, password_hash, password_salt, status are referenced by registration/login | Account identity and authentication | No account-deletion endpoint |
| D1 sessions | token_hash, user_id, expires_at | Bearer-session hashes; logout deletes the presented token; authentication rejects expired sessions. Login prunes expired sessions only for the account logging in; there is no global expired-session cleanup job | No account-wide revocation/deletion flow; expired rows may remain until that user logs in or an approved cleanup is implemented |
| D1 wallets | user_id, credits, updated_at | Current purchased-credit balance | Must reconcile before deletion |
| D1 orders | Referenced through credit_ledger.order_id; full columns and retention rules are not present in this repository | Likely payment/order records; exact schema is unverified | Do not delete or cascade blindly |
| D1 credit_ledger | user_id, order_id, credit_change, reason | Credit accounting/audit history | Retention and anonymization policy required before deletion |
| D1 usage_daily | user_id, action, usage_date, count | Daily usage/quota accounting | No account-deletion policy |
| D1 generation_reservations | Reservation ID/type/date/status/timestamps and user_id | Durable generation lifecycle; migration 0001 declares ON DELETE CASCADE to users | Cascade exists only for this table; migration is not applied to production |
| D1 auth_rate_limits | Hashed rate_key, window start and attempt count | Global IP/account rate-limit counters; no user foreign key | Hourly cleanup removes counters older than two days |
| Browser localStorage | contentpilot-saved-drafts-v1, contentpilot-calendar-v1 | Device/browser-local drafts and calendar; not stored in the account database | Must be addressed in user-facing deletion guidance |
| Browser localStorage | contentpilot-language | UI language preference | Preference only; not account data |
| Browser sessionStorage | contentpilot-access-token (session bearer token) | JavaScript-readable session token | Frontend logout clears it; server logout revokes the matching token |

## Required investigation before implementing deletion

1. Obtain and review the actual D1 schema for every table, including all foreign keys, indexes, triggers and constraints. Do not infer missing relationships from the Worker queries.
2. Confirm whether orders and credit_ledger contain financial records subject to retention, tax, fraud or dispute requirements. Define an approved retention/anonymization policy before removing or altering those rows.
3. Decide how outstanding wallet credits and in-flight reserved generations are handled. A deletion must not silently erase balances or leave a partially completed refund.
4. Define whether deletion is immediate or delayed, whether re-authentication is required, and how confirmation is delivered. Email verification and recovery are not implemented yet.
5. In one tested D1 transaction or a carefully designed staged workflow, revoke every session and process all account-owned rows according to the approved policy. Verify rollback and retry behavior against D1, not only SQLite.
6. Provide a separate device-local cleanup step for contentpilot-saved-drafts-v1 and contentpilot-calendar-v1; server-side deletion cannot clear other browsers or devices.
7. Test backup/restore, auditability and deletion completion before exposing the feature.

## Current decision

**Product decision: drafts and calendar entries remain browser-local for this release; they are not account-synced.** This matches the current implementation and avoids implying cross-device backup or server-side retention. Users manage these records per browser profile; clearing site data may permanently remove them. Revisit account sync only as a separate product decision with authentication, export/deletion behavior and retention rules designed first.

Do not add a destructive account-deletion endpoint until the production schema and financial-record retention policy are verified. The existing migration only guarantees cascade deletion for generation_reservations; it does not prove that deleting a user is safe for the other tables. Keep this as a documented pre-launch blocker rather than guessing at foreign keys or deleting ledger/order history.

## Safe schema inspection (operator-run only)

After confirming the target account and database, an authorized operator can inspect the D1 schema with a read-only query such as:

```sql
SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE type IN ('table', 'index', 'trigger')
ORDER BY type, name;
```

Do not run schema migrations or destructive SQL as part of this inspection.


## Retention decision register

See [DATA_RETENTION_REVIEW.md](./DATA_RETENTION_REVIEW.md) for the consolidated inventory and unresolved decisions. It intentionally does not invent retention periods or claim that the production schema, backups or provider logs have been verified.
