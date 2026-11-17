# Email ownership verification — implementation design

## Status and scope

Design only. The current Worker registers accounts as `active` and does not send verification mail. This document does not enable email delivery, change account status, or claim that an address has been verified. A delivery provider, sender identity, monitored support contact and approved product policy are still required.

## Proposed lifecycle

1. Registration creates a pending/unverified account. Do not grant authenticated generation access until verification is complete, unless the product owner explicitly chooses a documented grace policy.
2. Generate a cryptographically random, high-entropy, single-use token. Store only a SHA-256 digest; never store or log the raw token.
3. Persist the digest, user ID, purpose, creation time, expiry and consumed timestamp in a dedicated table with a uniqueness constraint. Use a short expiry (recommended initial policy: 30 minutes, subject to owner approval).
4. Send a generic confirmation message through a provider adapter. Do not reveal whether an email address already has an account in public responses.
5. On confirmation, atomically consume the unexpired token and transition the account to verified. A replay, expired token, wrong-purpose token or second use must fail.
6. Resend requests must be rate-limited by IP and normalized-email hash; invalidate or supersede prior outstanding tokens. Apply a cooldown and daily cap.
7. Keep delivery-provider errors generic to the browser; record a correlation ID and sanitized provider outcome, never the token or message body.

## Required implementation controls

- Token generation must use Web Crypto `crypto.getRandomValues`; store a digest, not a reversible token.
- Enforce purpose separation, expiry, single-use consumption and atomic state change in D1.
- Make account status checks consistent across login, `me`, logout and generation actions.
- Avoid account enumeration in registration and resend responses.
- Do not send passwords, session bearer tokens or other secrets by email.
- Use a fixed, configured HTTPS confirmation origin; never construct links from an untrusted Host or Origin header.
- Add abuse controls and alerts for resend spikes, delivery failures and token guessing.
- Keep verification tokens out of analytics, access logs, error traces and referrer-bearing third-party pages.
- Add mocked tests for expiry, replay, wrong purpose, atomic consume, resend throttling and delivery failure; then run staging D1 concurrency tests before production.

## Schema and rollout prerequisites

The repository does not contain a complete baseline migration for the existing users table. Inspect the actual D1 schema before designing a migration that alters user status or adds verification columns. Prefer a versioned migration and a staged rollout that remains compatible with the current Worker. Do not guess existing status values or constraints.

## Acceptance evidence

- Provider account and sender domain configured outside source control.
- Migration reviewed and tested against an isolated database.
- Verification links use a fixed HTTPS origin and tokens are never logged.
- Expiry, one-time use, replay, rate-limit and concurrent-consume tests pass.
- User-facing privacy notice and support process updated.
- Staging end-to-end delivery and verification succeeds.

Until these conditions pass, email ownership must not be described as verified.
