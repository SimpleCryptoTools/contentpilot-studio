# Data inventory and retention decision register

## Scope

This is a repository-derived inventory and decision worksheet, not a verified production D1 schema, legal opinion or approved retention policy. The repository lacks baseline migrations for several existing account and financial tables. Unknowns are intentionally left unresolved rather than assigned invented periods.

## Current inventory

| Data class | Known fields / location | Purpose | Current lifecycle evidence | Decision still required |
|---|---|---|---|---|
| Account identity | D1 `users`: id, email, password hash/salt, status | Authentication | No self-service deletion | Operator identity, lawful basis, correction and closure workflow |
| Session credentials | D1 `sessions`: token hash, user ID, expiry; browser sessionStorage token | Authenticated sessions | 30-day expiry; logout revokes presented token; no global expiry cleanup confirmed | Expired-row cleanup period, session revocation and audit policy |
| Wallet balances | D1 `wallets`: user ID, credits, updated_at | Credit balance | No verified account-close reconciliation | Treatment of unused credits and disputes |
| Orders | Referenced through ledger order_id; full schema unknown | Purchase/accounting records | Payment flow disabled in current code; production contents not inspected | Actual columns, legal/tax/dispute retention, access restrictions |
| Credit ledger | D1 `credit_ledger`: user ID, order ID, credit change, reason | Accounting/audit | No deletion policy | Immutable retention, anonymization and reconciliation rules |
| Usage | D1 `usage_daily`: user, action, date, count | Quota enforcement | No complete retention rule | Minimum operational period and aggregation/anonymization |
| Generation reservations | Migration 0001 schema; user foreign key cascades | Quota/refund state | Migration not verified on production | Retention after final state and dispute window |
| Auth rate limits | Hashed key, window, attempts | Abuse prevention | Scheduled deletion older than two days | Confirm actual deployed cron and whether aggregate security metrics are needed |
| Browser drafts/calendar | localStorage keys documented in lifecycle file | User-created content | Remains until user clears site data | Clear UI guidance and optional user-initiated export |
| Browser preference | localStorage language key | UI preference | Device-local | No server retention expected |
| Worker/platform logs | Console errors and platform logs | Diagnostics/security | Provider retention/settings unknown | Log fields, provider retention, access, region and deletion |
| Backups | D1 export / provider backup facilities | Recovery | No restore proof recorded | Backup cadence, encryption, access, retention and deletion propagation |
| Email/reset tokens | Not implemented | Account recovery | No current records | Token expiry, delivery-provider retention and audit minimization |

## Decisions that require owner/legal approval

For each data class, record: purpose, controller/processor, lawful basis where applicable, exact fields, system of record, access roles, retention trigger, retention duration, deletion/anonymization method, backup expiry, cross-border processing and user request path.

Do not infer a retention period from technical token expiry or cleanup schedules. A two-day rate-limit cleanup is not a general log-retention policy. A 30-day session expiry is not a statement about how long session rows remain stored.

## Safe next actions

1. Export a schema-only inventory from the confirmed D1 environment; do not retrieve customer rows for this task.
2. Compare production schema with repository SQL and migrations.
3. Identify provider-side logs, analytics and backup copies from account settings and provider documentation.
4. Ask the operator/legal reviewer to approve retention periods and financial-record exceptions.
5. Update the privacy notice only after decisions and deployed provider configuration are confirmed.
6. Design deletion/export workflows only after foreign keys, ledger constraints and backup behavior are verified.

## Current release position

No retention durations are approved by this file. Account deletion, export and correction endpoints remain blocked until the actual schema and applicable financial/security retention requirements are verified. Browser drafts/calendar remain device-local and may be lost when site data is cleared.
