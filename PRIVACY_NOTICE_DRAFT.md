# ContentPilot Studio — Privacy Notice Draft

> **Draft for product and legal review.** This document describes behavior observed in the current repository code. It is not a published legal policy and must be reviewed and completed before public launch. Replace the contact placeholders and confirm the deployed infrastructure and applicable legal requirements.

## Information handled by the current application

### Account information
- Registration and login send the email address and password to the ContentPilot API.
- The Worker derives password hashes using PBKDF2-SHA-256 with a per-account random salt. The plaintext password is not intentionally stored by the application.
- The Worker stores account records and hashed session-token values in the configured Cloudflare D1 database.
- A session token is held in the browser's `sessionStorage` and is sent to the API as a bearer token when account features are used.
- Session records are created with a 30-day expiry. The application does not currently provide a complete account-deletion or password-reset flow.

### Prompts and generated content
- Text and image prompts submitted for generation are sent to the ContentPilot Worker and passed to the configured Cloudflare Workers AI model.
- Generated text and images are returned to the browser. Saved text drafts and content-calendar entries are stored in that browser's `localStorage`; they are not synchronized between devices or stored as account drafts by the application. Product decision for this release: drafts and calendar remain browser-local; clearing browser/site data may permanently remove them, and they do not automatically follow the user to another device.
- Anyone with access to the same browser profile may be able to access locally saved drafts and calendar entries.

### Usage and security data
- The Worker stores daily generation counts and credit-balance/ledger records in D1 to enforce quotas.
- Authentication rate-limit keys are derived from IP address and normalized email using SHA-256 before storage. The raw values are not stored in the rate-limit table by this code.
- Worker errors are written to the platform console. Production log access and retention settings must be reviewed before launch.

## Payments, email and analytics
- Payment/top-up functionality is inactive in the current code. Do not treat the application as accepting payments.
- Email verification and password-reset delivery are not implemented in the current code.
- This repository review did not establish whether separate hosting/platform analytics or logs are enabled. Confirm those settings before publishing a final notice.

## Retention and user controls
- Browser-local drafts and calendar entries remain in the browser until the user clears them or removes the relevant browser data.
- The application currently has no complete self-service account/data deletion workflow. Define and implement deletion and retention procedures before public launch.
- Do not promise a deletion timeframe until database, backups, logs and provider retention behavior have been confirmed.

## Service providers and international processing
- The current architecture uses GitHub Pages for static hosting (after domain configuration) and Cloudflare Workers, D1 and Workers AI for API, database and AI processing. Confirm the actual production configuration and the providers' current terms and locations before publication.

## Required completion before publication
1. Add the legal operator's name, business address and a monitored privacy contact: **[operator and contact details required]**.
2. Confirm the final list of hosting, database, AI, analytics, email and monitoring providers.
3. Decide and document retention periods for account, usage, security-log and backup data.
4. Implement account deletion and a workable way for users to request access/correction/deletion where required.
5. Decide whether email verification and password reset will be provided, then implement and test them before promising these features.
6. Have the notice reviewed for the countries in which the service will operate.



## Decision recorded for this release
Drafts and calendar remain browser-local. They are not account-synced. Clearing browser/site data may permanently remove them. This notice remains a draft until the operator/contact, deployed providers, retention and applicable legal review are completed.
