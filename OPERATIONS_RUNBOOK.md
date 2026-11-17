# ContentPilot operations and incident runbook

## Status

Preparation document only. It does not configure Cloudflare observability, create alerts, set log retention, or nominate an incident contact. Production logs/monitoring are not confirmed active.

## Before enabling production traffic

- Confirm the Worker, D1 database UUID, domain and deployment commit with the service owner.
- Establish an on-call/incident contact and an escalation backup; do not publish personal contact details in this repository.
- Define service objectives and alert thresholds from measured baseline traffic, not guessed values.
- Confirm Cloudflare dashboard access is least-privilege and protected with MFA.
- Confirm log retention, region, access roles and privacy settings in the provider dashboard.
- Ensure secrets are stored in the provider secret store, never in Git, issues or chat.
- Keep payments disabled until signed callbacks and idempotent fulfillment have passed review.

## Privacy-safe telemetry

Prefer aggregate counters and correlation IDs. Never log passwords, bearer tokens, reset/verification tokens, full prompts, generated private content, raw email addresses, payment credentials or complete request bodies.

Useful event fields: timestamp, environment, Worker version/commit, route/action category, response status, duration, correlation ID, sanitized error class and dependency outcome. IP addresses and email-derived identifiers are personal/security data; minimize, hash where appropriate, restrict access and set an approved retention period.

## Initial alert candidates (thresholds require measured baselines)

- Elevated 5xx rate or sustained latency on API routes.
- D1 unavailable, repeated query/batch failures or migration/schema mismatch.
- Workers AI binding/model errors or unusual generation failure/refund rates.
- Authentication rate-limit spikes or unusual registration/login patterns.
- Scheduled cleanup invocation failures.
- Domain/TLS/edge routing failures after the domain is activated.

Do not alert on individual user prompts or include sensitive payloads in notifications.

## Incident procedure

1. Acknowledge and record incident start time, environment and correlation IDs.
2. Determine whether the issue affects availability, confidentiality, integrity, billing or account access.
3. Preserve relevant sanitized logs and deployment metadata; restrict access to evidence.
4. For suspected credential exposure, follow the approved session-revocation and secret-rotation procedure. Do not paste secrets into incident notes.
5. For D1 integrity concerns, stop risky writes and obtain owner approval before restore or migration actions. Never restore over production as an exploratory step.
6. For payment discrepancies, keep purchases disabled and reconcile ledger/order records before any manual correction.
7. Communicate status through the approved incident contact; do not speculate about scope or user impact.
8. Record root cause, remediation, follow-up owner and evidence after resolution.

## Recovery prerequisites

Maintain a separately verified D1 backup/restore procedure, a known-good Worker release identifier, reviewed migration history and an owner-approved rollback plan. A backup export without a tested isolated restore is not a proven recovery capability.

## Incident record template

- Incident ID / start / end:
- Environment and Worker commit:
- Detection source and sanitized correlation IDs:
- Affected service and observed impact:
- Data/security/billing impact assessment:
- Actions taken and approving owner:
- Recovery verification:
- Root cause and prevention actions:
- Communications owner:
